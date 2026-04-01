from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
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

# Configure logging before anything else uses logger
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL')
if not mongo_url:
    raise ValueError("MONGO_URL environment variable is required but not set")
db_name = os.environ.get('DB_NAME')
if not db_name:
    raise ValueError("DB_NAME environment variable is required but not set")
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

# Google Sheets setup
SHEETS_ENABLED = os.getenv('GOOGLE_SHEETS_ENABLED', 'false').lower() == 'true'
SPREADSHEET_ID = os.getenv('SPREADSHEET_ID', '')
SHEET_NAME = os.getenv('SHEET_NAME', 'Sheet5')

# Thread pool for sync operations
executor = ThreadPoolExecutor(max_workers=3)

# Rate limiting setup
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    client.close()


# Create the main app
app = FastAPI(title="Communitree Lead API - Secured", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


def get_client_ip(request: Request) -> str:
    """Extract real client IP, handling proxy X-Forwarded-For headers."""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # First entry is the original client; strip whitespace
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ═══════════════════════════════════════════════════════════════════════════════════
# SECURITY MIDDLEWARE
# ═══════════════════════════════════════════════════════════════════════════════════

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses"""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        headers = SecurityHeaders.get_headers()
        for key, value in headers.items():
            response.headers[key] = value
        return response


class MaxBodySizeMiddleware(BaseHTTPMiddleware):
    """Reject requests with body larger than 50KB before they are parsed"""
    MAX_BODY_BYTES = 50 * 1024  # 50 KB

    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > self.MAX_BODY_BYTES:
            return JSONResponse(
                status_code=413,
                content={"detail": "Request body too large (max 50KB)"}
            )
        return await call_next(request)


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(MaxBodySizeMiddleware)


# ═══════════════════════════════════════════════════════════════════════════════════
# GOOGLE SHEETS SYNC
# ═══════════════════════════════════════════════════════════════════════════════════

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
            except (ValueError, AttributeError):
                logger.warning("Could not parse submitted_at date, using raw value")
        
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
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, sync_lead_to_sheets, lead_data)


# ═══════════════════════════════════════════════════════════════════════════════════
# MODELS WITH SECURITY VALIDATION
# ═══════════════════════════════════════════════════════════════════════════════════

class Lead(BaseModel):
    """Lead model for database storage with sanitization"""
    model_config = ConfigDict(extra="ignore")
    
    leadId: str
    email: EmailStr
    fullName: str
    phone: str
    company: str
    orgName: str
    submittedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    @validator('leadId')
    def validate_lead_id(cls, v):
        """Sanitize and validate Lead ID"""
        try:
            return sanitize_lead_id(v)
        except ValueError as e:
            raise ValueError(f"Invalid Lead ID: {str(e)}")
    
    @validator('email')
    def validate_email(cls, v):
        """Sanitize email"""
        return v.lower().strip()
    
    @validator('fullName', 'company', 'orgName')
    def sanitize_text_fields(cls, v):
        """Sanitize text fields"""
        return sanitize_string(v, max_length=200)
    
    @validator('phone')
    def sanitize_phone(cls, v):
        """Sanitize phone number"""
        import re
        sanitized = re.sub(r'[^0-9+\-() ]', '', v)
        if len(sanitized) > 20:
            raise ValueError("Phone number too long")
        if not re.search(r'\d{7,}', sanitized):
            raise ValueError("Phone number must contain at least 7 digits")
        return sanitized

class LeadCreate(BaseModel):
    """Lead creation/update input with strict validation"""
    leadId: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    fullName: str = Field(..., min_length=1, max_length=200)
    phone: str = Field(..., min_length=3, max_length=20)
    company: str = Field(..., min_length=1, max_length=200)
    orgName: str = Field(..., min_length=1, max_length=200)
    
    @validator('leadId')
    def validate_lead_id(cls, v):
        try:
            return sanitize_lead_id(v)
        except ValueError as e:
            raise ValueError(f"Invalid Lead ID: {str(e)}")
    
    @validator('fullName', 'company', 'orgName')
    def sanitize_text_fields(cls, v):
        return sanitize_string(v, max_length=200)
    
    @validator('phone')
    def sanitize_phone(cls, v):
        import re
        sanitized = re.sub(r'[^0-9+\-() ]', '', v)
        if len(sanitized) > 20:
            raise ValueError("Phone number too long")
        if not re.search(r'\d{7,}', sanitized):
            raise ValueError("Phone number must contain at least 7 digits")
        return sanitized

class CheckRequest(BaseModel):
    """Check duplicate request"""
    leadId: str = Field(..., min_length=1, max_length=100)
    
    @validator('leadId')
    def validate_lead_id(cls, v):
        try:
            return sanitize_lead_id(v)
        except ValueError as e:
            raise ValueError(f"Invalid Lead ID: {str(e)}")

class SubmitRequest(BaseModel):
    """Submit lead request"""
    data: LeadCreate
    replace: bool = False

class CheckResponse(BaseModel):
    """Check duplicate response"""
    isDuplicate: bool
    leadId: str
    lead: Optional[dict] = None

class SubmitResponse(BaseModel):
    """Submit lead response"""
    success: bool
    message: str
    leadId: str


# ═══════════════════════════════════════════════════════════════════════════════════
# ROUTES WITH SECURITY
# ═══════════════════════════════════════════════════════════════════════════════════

@api_router.get("/")
async def root():
    """Health check endpoint"""
    return {"status": "ok", "message": "Communitree Lead API is live."}


@api_router.post("/check", response_model=CheckResponse)
@limiter.limit("30/minute")  # Rate limit: 30 checks per minute
async def check_duplicate(request: Request, check_request: CheckRequest):
    """
    Check if a leadId exists in the database.
    O(1) complexity using direct document lookup.
    Rate limited to prevent abuse.
    """
    try:
        # Validate request size
        validate_request_size(check_request.dict(), max_size_kb=10)
        
        # Normalize leadId (case-insensitive)
        normalized_lead_id = check_request.leadId.strip().lower()
        
        # Security: Log excessive checks from same IP
        client_ip = get_client_ip(request)
        if anomaly_detector.check_suspicious_activity(f"check_{client_ip}", threshold=50):
            log_security_event("EXCESSIVE_CHECK_REQUESTS", {"ip": client_ip})
        
        # Direct lookup using leadId as _id (O(1) operation)
        # Fetch only _id — never return PII from an unauthenticated endpoint
        existing_lead = await db.leads.find_one(
            {"_id": normalized_lead_id},
            {"_id": 1}
        )

        return CheckResponse(
            isDuplicate=existing_lead is not None,
            leadId=check_request.leadId,
            lead=None  # PII must not be returned from unauthenticated /check
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error checking duplicate: {str(e)}")
        raise HTTPException(status_code=500, detail="An error occurred while checking lead")


@api_router.post("/submit", response_model=SubmitResponse)
@limiter.limit("10/minute")  # Rate limit: 10 submissions per minute
async def submit_lead(request: Request, submit_request: SubmitRequest):
    """
    Submit a new lead or replace an existing one.
    Uses leadId as the document _id for O(1) operations.
    Syncs to Google Sheets if enabled.
    Rate limited to prevent spam.
    """
    try:
        # Validate request size (max 50KB)
        validate_request_size(submit_request.dict(), max_size_kb=50)
        
        lead_data = submit_request.data
        normalized_lead_id = lead_data.leadId.strip().lower()
        
        # Security: Detect suspicious submission patterns
        client_ip = get_client_ip(request)
        if anomaly_detector.check_suspicious_activity(f"submit_{normalized_lead_id}", threshold=5):
            log_security_event("EXCESSIVE_SUBMISSIONS", {
                "ip": client_ip,
                "leadId": lead_data.leadId
            })
            raise HTTPException(
                status_code=429,
                detail="Too many submissions for this Lead ID. Please try again later."
            )
        
        # Check if lead exists
        existing_lead = await db.leads.find_one(
            {"_id": normalized_lead_id},
            {"_id": 1}
        )
        
        # If lead exists and replace is False, return error
        if existing_lead and not submit_request.replace:
            return SubmitResponse(
                success=False,
                message=f"Lead {lead_data.leadId} already exists. Use replace=true to update.",
                leadId=lead_data.leadId
            )
        
        # Create lead object with validation
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
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error submitting lead: {str(e)}")
        raise HTTPException(status_code=500, detail="An error occurred while submitting lead")


@api_router.get("/lead/{lead_id}")
@limiter.limit("30/minute")
async def get_lead_by_id(request: Request, lead_id: str, api_key: str = Depends(verify_api_key)):
    """
    Get a specific lead by leadId
    Rate limited to prevent scraping
    """
    try:
        # Sanitize lead_id
        sanitized_lead_id = sanitize_lead_id(lead_id)
        normalized_lead_id = sanitized_lead_id.strip().lower()
        
        lead = await db.leads.find_one(
            {"_id": normalized_lead_id},
            {"_id": 0}
        )
        
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")
        
        return {"success": True, "lead": lead}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching lead: {str(e)}")
        raise HTTPException(status_code=500, detail="An error occurred while fetching lead")


@api_router.get("/leads")
@limiter.limit("10/minute")  # Strict rate limit for bulk data
async def get_all_leads(
    request: Request,
    api_key: str = Depends(verify_api_key)
):
    """
    Get all leads (admin endpoint - requires API key)
    """
    try:
        leads = await db.leads.find({}, {"_id": 0}).sort("submittedAt", -1).limit(1000).to_list(1000)
        return {"success": True, "count": len(leads), "leads": leads}
    except Exception as e:
        logger.error(f"Error fetching leads: {str(e)}")
        raise HTTPException(status_code=500, detail="An error occurred while fetching leads")


# Include the router in the main app
app.include_router(api_router)

# CORS middleware (add after routes)
_cors_origins = os.environ.get('CORS_ORIGINS', 'http://localhost:3000').split(',')
_cors_origins = [o.strip() for o in _cors_origins if o.strip()]
# Always allow the permanent deployments
for _origin in ['https://shashankgowda7755.github.io', 'https://build-pi-taupe.vercel.app']:
    if _origin not in _cors_origins:
        _cors_origins.append(_origin)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "X-API-Key"],
)

