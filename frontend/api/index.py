"""
Vercel Serverless Function — Communitree Lead API
Uses synchronous pymongo (not async Motor) to avoid asyncio event-loop
reuse issues that occur in Vercel's per-invocation serverless runtime.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict, field_validator
from datetime import datetime, timezone
import os, re, logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://interchange.proxy.rlwy.net:20863")
DB_NAME   = os.environ.get("DB_NAME",   "leads_database")

# Sync client — safe to reuse across Vercel invocations (no event-loop binding)
_client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=8000, connectTimeoutMS=8000)
_db     = _client[DB_NAME]

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ── Helpers ───────────────────────────────────────────────────────────
def sanitize_string(v: str, max_length: int = 200) -> str:
    return re.sub(r'[<>&"\']', '', v.strip())[:max_length]

def sanitize_lead_id(v: str) -> str:
    v = v.strip()
    if not v or not re.match(r'^[a-zA-Z0-9\-_]+$', v):
        raise ValueError("Lead ID may only contain letters, numbers, hyphens, underscores")
    if len(v) > 100:
        raise ValueError("Lead ID too long (max 100)")
    return v

# ── Models ────────────────────────────────────────────────────────────
class LeadCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    leadId:   str = Field(..., min_length=1, max_length=100)
    email:    EmailStr
    fullName: str = Field(..., min_length=1, max_length=200)
    phone:    str = Field(..., min_length=3, max_length=20)
    company:  str = Field(..., min_length=1, max_length=200)
    orgName:  str = Field(..., min_length=1, max_length=200)

    @field_validator("leadId")
    @classmethod
    def val_lead_id(cls, v): return sanitize_lead_id(v)

    @field_validator("fullName", "company", "orgName")
    @classmethod
    def val_text(cls, v): return sanitize_string(v, 200)

    @field_validator("phone")
    @classmethod
    def val_phone(cls, v):
        s = re.sub(r'[^0-9+\-() ]', '', v)
        if len(s) > 20:             raise ValueError("Phone number too long")
        if len(re.findall(r'\d', s)) < 7: raise ValueError("Phone must have ≥7 digits")
        return s

class CheckRequest(BaseModel):
    leadId: str = Field(..., min_length=1, max_length=100)

    @field_validator("leadId")
    @classmethod
    def val_lead_id(cls, v): return sanitize_lead_id(v)

class SubmitRequest(BaseModel):
    data:    LeadCreate
    replace: bool = False

# ── Routes (sync handlers — FastAPI runs them in a thread pool) ────────
@app.get("/api")
@app.get("/api/")
def health():
    return {"status": "ok", "message": "Communitree Lead API is live."}


@app.post("/api/check")
def check_duplicate(req: CheckRequest):
    try:
        norm = req.leadId.strip().lower()
        existing = _db.leads.find_one({"_id": norm})
        if existing:
            # Strip internal _id; return the rest so the frontend can show the previous entry
            lead_data = {k: v for k, v in existing.items() if k != "_id"}
            return {"isDuplicate": True, "leadId": req.leadId, "lead": lead_data}
        return {"isDuplicate": False, "leadId": req.leadId, "lead": None}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"check error: {e}")
        raise HTTPException(500, "Error checking lead")


@app.post("/api/submit")
def submit_lead(req: SubmitRequest):
    try:
        d    = req.data
        norm = d.leadId.strip().lower()

        existing = _db.leads.find_one({"_id": norm}, {"_id": 1})
        if existing and not req.replace:
            return {"success": False,
                    "message": f"Lead {d.leadId} already exists. Use replace=true to update.",
                    "leadId": d.leadId}

        doc = d.model_dump()
        doc["submittedAt"] = datetime.now(timezone.utc).isoformat()
        doc["_id"]         = norm
        doc["leadId"]      = d.leadId

        _db.leads.replace_one({"_id": norm}, doc, upsert=True)
        action = "updated" if existing else "created"
        return {"success": True,
                "message": f"Lead {d.leadId} successfully {action}.",
                "leadId": d.leadId}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"submit error: {e}")
        raise HTTPException(500, "Error submitting lead")
