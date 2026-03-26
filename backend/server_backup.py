from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, ConfigDict, validator
from typing import Optional
from datetime import datetime, timezone
import gspread
from google.oauth2.service_account import Credentials
import asyncio
from concurrent.futures import ThreadPoolExecutor
from security import (
    sanitize_string, 
    sanitize_lead_id, 
    sanitize_email,
    validate_request_size,
    SecurityHeaders,
    verify_api_key,
    anomaly_detector,
    log_security_event
)


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Google Sheets setup
SHEETS_ENABLED = os.getenv('GOOGLE_SHEETS_ENABLED', 'false').lower() == 'true'
SPREADSHEET_ID = os.getenv('SPREADSHEET_ID', '')
SHEET_NAME = os.getenv('SHEET_NAME', 'Sheet5')

# Thread pool for sync operations
executor = ThreadPoolExecutor(max_workers=3)

# Rate limiting setup
limiter = Limiter(key_func=get_remote_address)

# Create the main app without a prefix
app = FastAPI(title="Communitree Lead API - Secured")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

def get_sheets_client():
    """Initialize Google Sheets client"""
    if not SHEETS_ENABLED:
        return None
    try:
        creds_path = ROOT_DIR / 'google_credentials.json'
        scopes = ['https://www.googleapis.com/auth/spreadsheets']
        creds = Credentials.from_service_account_file(str(creds_path), scopes=scopes)
        return gspread.authorize(creds)
    except Exception as e:
        logger.error(f"Failed to initialize Google Sheets client: {str(e)}")
        return None

def sync_lead_to_sheets(lead_data):
    """Sync a single lead to Google Sheets (runs in thread pool)"""
    try:
        gc = get_sheets_client()
        if not gc:
            logger.warning("Google Sheets sync disabled or failed to initialize")
            return False
        
        sheet = gc.open_by_key(SPREADSHEET_ID).worksheet(SHEET_NAME)
        
        # Check if headers exist
        try:
            headers = sheet.row_values(1)
            if not headers or len(headers) == 0:
                # Create headers
                headers = ['Lead ID', 'Email', 'Full Name', 'Phone Number', 'Company', 'Submitted At', 'Submitted By (Org)']
                sheet.append_row(headers)
                # Format header row
                sheet.format('A1:G1', {
                    'backgroundColor': {'red': 0.1, 'green': 0.48, 'blue': 0.29},
                    'textFormat': {'bold': True, 'foregroundColor': {'red': 1, 'green': 1, 'blue': 1}}
                })
        except Exception as header_error:
            logger.warning(f"Header check/creation failed: {str(header_error)}")
        
        # Prepare row data
        submitted_at = lead_data.get('submittedAt', '')
        if isinstance(submitted_at, str):
            try:
                dt = datetime.fromisoformat(submitted_at.replace('Z', '+00:00'))
                submitted_at = dt.strftime('%Y-%m-%d %H:%M:%S')
            except:
                pass
        
        row = [
            lead_data.get('leadId', ''),
            lead_data.get('email', ''),
            lead_data.get('fullName', ''),
            lead_data.get('phone', ''),
            lead_data.get('company', ''),
            submitted_at,
            lead_data.get('orgName', '')
        ]
        
        # Check if lead exists and update, otherwise append
        normalized_lead_id = lead_data.get('leadId', '').strip().lower()
        
        try:
            # Find the row with matching lead ID (case-insensitive)
            cell = sheet.find(normalized_lead_id, in_column=1)
            if cell:
                # Update existing row
                sheet.update(f'A{cell.row}:G{cell.row}', [row])
                logger.info(f"Updated lead {lead_data.get('leadId')} in Google Sheets (row {cell.row})")
            else:
                # Append new row
                sheet.append_row(row)
                logger.info(f"Appended lead {lead_data.get('leadId')} to Google Sheets")
        except gspread.exceptions.CellNotFound:
            # Lead not found, append
            sheet.append_row(row)
            logger.info(f"Appended lead {lead_data.get('leadId')} to Google Sheets")
        
        return True
    except Exception as e:
        logger.error(f"Error syncing to Google Sheets: {str(e)}", exc_info=True)
        return False

async def sync_lead_to_sheets_async(lead_data):
    """Async wrapper for Google Sheets sync"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, sync_lead_to_sheets, lead_data)

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
    Syncs to Google Sheets if enabled.
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
        
        # Sync to Google Sheets in background (non-blocking)
        if SHEETS_ENABLED:
            asyncio.create_task(sync_lead_to_sheets_async(doc))
            logger.info(f"Scheduled Google Sheets sync for lead {lead_data.leadId}")
        
        return SubmitResponse(
            success=True,
            message=f"Lead {lead_data.leadId} successfully {action}.",
            leadId=lead_data.leadId
        )
        
    except Exception as e:
        logger.error(f"Error submitting lead: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error submitting lead: {str(e)}")


@api_router.get("/lead/{lead_id}")
async def get_lead_by_id(lead_id: str):
    """
    Get a specific lead by leadId
    """
    try:
        normalized_lead_id = lead_id.strip().lower()
        lead = await db.leads.find_one(
            {"_id": normalized_lead_id},
            {"_id": 0}
        )
        
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")
        
        return {"success": True, "lead": lead}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching lead: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching lead: {str(e)}")


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