from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from typing import Optional
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# ═══════════════════════════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════════════════════════

class Lead(BaseModel):
    """Lead model for database storage"""
    model_config = ConfigDict(extra="ignore")
    
    leadId: str
    email: EmailStr
    fullName: str
    phone: str
    company: str
    orgName: str
    submittedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class LeadCreate(BaseModel):
    """Lead creation/update input"""
    leadId: str = Field(..., min_length=1, description="Unique lead identifier")
    email: EmailStr
    fullName: str = Field(..., min_length=1)
    phone: str = Field(..., min_length=1)
    company: str = Field(..., min_length=1)
    orgName: str = Field(..., min_length=1)

class CheckRequest(BaseModel):
    """Check duplicate request"""
    leadId: str = Field(..., min_length=1)

class SubmitRequest(BaseModel):
    """Submit lead request"""
    data: LeadCreate
    replace: bool = False

class CheckResponse(BaseModel):
    """Check duplicate response"""
    isDuplicate: bool
    leadId: str

class SubmitResponse(BaseModel):
    """Submit lead response"""
    success: bool
    message: str
    leadId: str


# ═══════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════

@api_router.get("/")
async def root():
    return {"status": "ok", "message": "Communitree Lead API is live."}


@api_router.post("/check", response_model=CheckResponse)
async def check_duplicate(request: CheckRequest):
    """
    Check if a leadId exists in the database.
    O(1) complexity using direct document lookup.
    """
    try:
        # Normalize leadId (case-insensitive)
        normalized_lead_id = request.leadId.strip().lower()
        
        # Direct lookup using leadId as _id (O(1) operation)
        existing_lead = await db.leads.find_one(
            {"_id": normalized_lead_id},
            {"_id": 1}
        )
        
        return CheckResponse(
            isDuplicate=existing_lead is not None,
            leadId=request.leadId
        )
    except Exception as e:
        logger.error(f"Error checking duplicate: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error checking duplicate: {str(e)}")


@api_router.post("/submit", response_model=SubmitResponse)
async def submit_lead(request: SubmitRequest):
    """
    Submit a new lead or replace an existing one.
    Uses leadId as the document _id for O(1) operations.
    """
    try:
        lead_data = request.data
        normalized_lead_id = lead_data.leadId.strip().lower()
        
        # Check if lead exists
        existing_lead = await db.leads.find_one(
            {"_id": normalized_lead_id},
            {"_id": 1}
        )
        
        # If lead exists and replace is False, return error
        if existing_lead and not request.replace:
            return SubmitResponse(
                success=False,
                message=f"Lead {lead_data.leadId} already exists. Use replace=true to update.",
                leadId=lead_data.leadId
            )
        
        # Create lead object
        lead = Lead(**lead_data.model_dump())
        
        # Prepare document for MongoDB
        doc = lead.model_dump()
        doc['submittedAt'] = doc['submittedAt'].isoformat()
        
        # Use normalized leadId as _id
        doc['_id'] = normalized_lead_id
        # Keep original leadId for display purposes
        doc['leadId'] = lead_data.leadId
        
        # Insert or replace (upsert)
        await db.leads.replace_one(
            {"_id": normalized_lead_id},
            doc,
            upsert=True
        )
        
        action = "updated" if existing_lead else "created"
        
        return SubmitResponse(
            success=True,
            message=f"Lead {lead_data.leadId} successfully {action}.",
            leadId=lead_data.leadId
        )
        
    except Exception as e:
        logger.error(f"Error submitting lead: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error submitting lead: {str(e)}")


@api_router.get("/leads")
async def get_all_leads():
    """
    Get all leads (for admin/debugging purposes)
    """
    try:
        leads = await db.leads.find({}, {"_id": 0}).sort("submittedAt", -1).to_list(1000)
        return {"success": True, "count": len(leads), "leads": leads}
    except Exception as e:
        logger.error(f"Error fetching leads: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching leads: {str(e)}")


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()