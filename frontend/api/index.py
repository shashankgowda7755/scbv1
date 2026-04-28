"""
Vercel Serverless Function — Communitree Lead API
Runs on the SAME domain as the frontend. No CORS issues.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict, field_validator
from typing import Optional
from datetime import datetime, timezone
import os, re, logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Railway MongoDB proxy is always reachable; fall back to it if Atlas is unavailable
RAILWAY_MONGO_PROXY = "mongodb://interchange.proxy.rlwy.net:20863"
MONGO_URL = os.environ.get("MONGO_URL", RAILWAY_MONGO_PROXY)
DB_NAME = os.environ.get("DB_NAME", "leads_database")

client = AsyncIOMotorClient(
    MONGO_URL,
    serverSelectionTimeoutMS=8000,
    connectTimeoutMS=8000,
    socketTimeoutMS=15000,
)
db = client[DB_NAME]

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ── Sanitization helpers ──────────────────────────────────────────────
def sanitize_string(v: str, max_length: int = 200) -> str:
    v = v.strip()
    v = re.sub(r'[<>&"\']', '', v)
    return v[:max_length]

def sanitize_lead_id(v: str) -> str:
    v = v.strip()
    if not v or not re.match(r'^[a-zA-Z0-9\-_]+$', v):
        raise ValueError("Lead ID may only contain letters, numbers, hyphens, underscores")
    if len(v) > 100:
        raise ValueError("Lead ID too long (max 100)")
    return v

# ── Pydantic models ───────────────────────────────────────────────────
class Lead(BaseModel):
    model_config = ConfigDict(extra="ignore")
    leadId: str
    email: EmailStr
    fullName: str
    phone: str
    company: str
    orgName: str
    submittedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator('leadId')
    @classmethod
    def validate_lead_id(cls, v):
        return sanitize_lead_id(v)

    @field_validator('email')
    @classmethod
    def validate_email(cls, v):
        return v.lower().strip()

    @field_validator('fullName', 'company', 'orgName')
    @classmethod
    def sanitize_text(cls, v):
        return sanitize_string(v, 200)

    @field_validator('phone')
    @classmethod
    def sanitize_phone(cls, v):
        sanitized = re.sub(r'[^0-9+\-() ]', '', v)
        if len(sanitized) > 20:
            raise ValueError("Phone number too long")
        if len(re.findall(r'\d', sanitized)) < 7:
            raise ValueError("Phone number must contain at least 7 digits")
        return sanitized

class LeadCreate(BaseModel):
    leadId: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    fullName: str = Field(..., min_length=1, max_length=200)
    phone: str = Field(..., min_length=3, max_length=20)
    company: str = Field(..., min_length=1, max_length=200)
    orgName: str = Field(..., min_length=1, max_length=200)

    @field_validator('leadId')
    @classmethod
    def validate_lead_id(cls, v):
        return sanitize_lead_id(v)

    @field_validator('fullName', 'company', 'orgName')
    @classmethod
    def sanitize_text(cls, v):
        return sanitize_string(v, 200)

    @field_validator('phone')
    @classmethod
    def sanitize_phone(cls, v):
        sanitized = re.sub(r'[^0-9+\-() ]', '', v)
        if len(sanitized) > 20:
            raise ValueError("Phone number too long")
        if len(re.findall(r'\d', sanitized)) < 7:
            raise ValueError("Phone number must contain at least 7 digits")
        return sanitized

class CheckRequest(BaseModel):
    leadId: str = Field(..., min_length=1, max_length=100)

    @field_validator('leadId')
    @classmethod
    def validate_lead_id(cls, v):
        return sanitize_lead_id(v)

class SubmitRequest(BaseModel):
    data: LeadCreate
    replace: bool = False

# ── Routes ────────────────────────────────────────────────────────────
@app.get("/api")
@app.get("/api/")
async def health():
    return {"status": "ok", "message": "Communitree Lead API is live."}

@app.post("/api/check")
async def check_duplicate(req: CheckRequest):
    try:
        normalized = req.leadId.strip().lower()
        existing = await db.leads.find_one({"_id": normalized}, {"_id": 1})
        return {"isDuplicate": existing is not None, "leadId": req.leadId, "lead": None}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Check error: {e}")
        raise HTTPException(status_code=500, detail="Error checking lead")

@app.post("/api/submit")
async def submit_lead(req: SubmitRequest):
    try:
        lead_data = req.data
        normalized = lead_data.leadId.strip().lower()

        existing = await db.leads.find_one({"_id": normalized}, {"_id": 1})

        if existing and not req.replace:
            return {"success": False, "message": f"Lead {lead_data.leadId} already exists.", "leadId": lead_data.leadId}

        lead = Lead(**lead_data.model_dump())
        doc = lead.model_dump()
        doc['submittedAt'] = doc['submittedAt'].isoformat()
        doc['_id'] = normalized
        doc['leadId'] = lead_data.leadId

        await db.leads.replace_one({"_id": normalized}, doc, upsert=True)

        action = "updated" if existing else "created"
        return {"success": True, "message": f"Lead {lead_data.leadId} successfully {action}.", "leadId": lead_data.leadId}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Submit error: {e}")
        raise HTTPException(status_code=500, detail="Error submitting lead")
