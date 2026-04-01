"""
Security utilities for the Lead Generation API
Includes: Input sanitization, rate limiting, authentication
"""

import re
import time
import hmac
import unicodedata
from typing import Optional
from fastapi import HTTPException, Request, Security, status
from fastapi.security import APIKeyHeader
import os
import logging

logger = logging.getLogger(__name__)

# API Key for admin endpoints
API_KEY = os.getenv("API_KEY", "")  # Set this in production
API_KEY_NAME = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

# Brute-force tracker: {ip: {"failures": int, "window_start": float}}
_api_key_failures: dict = {}
_API_KEY_LOCKOUT_THRESHOLD = 10   # max failed attempts per window
_API_KEY_LOCKOUT_WINDOW = 300     # 5-minute window
_API_KEY_MAX_TRACKED_IPS = 10_000  # hard cap to prevent memory exhaustion


def _purge_expired_api_key_failures() -> None:
    """Remove expired entries from the brute-force tracker."""
    now = time.time()
    expired = [k for k, v in _api_key_failures.items()
               if now - v["window_start"] > _API_KEY_LOCKOUT_WINDOW]
    for k in expired:
        del _api_key_failures[k]


async def verify_api_key(api_key: str = Security(api_key_header), request: Request = None) -> str:
    """
    Verify API key for protected endpoints with brute-force lockout.
    After 10 failed attempts in 5 minutes from the same IP, further attempts are blocked.
    """
    if not API_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API key not configured on server"
        )

    # Determine caller IP for brute-force tracking
    caller_ip = "unknown"
    if request is not None:
        forwarded_for = request.headers.get("X-Forwarded-For")
        caller_ip = forwarded_for.split(",")[0].strip() if forwarded_for else (
            request.client.host if request.client else "unknown"
        )

    now = time.time()
    entry = _api_key_failures.get(caller_ip)

    # Reset window if expired
    if entry and now - entry["window_start"] > _API_KEY_LOCKOUT_WINDOW:
        del _api_key_failures[caller_ip]
        entry = None

    # Block if over threshold
    if entry and entry["failures"] >= _API_KEY_LOCKOUT_THRESHOLD:
        log_security_event("API_KEY_BRUTE_FORCE_BLOCKED", {"ip": caller_ip})
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Try again later."
        )

    if not hmac.compare_digest(api_key or "", API_KEY):
        # Record failure — purge first if dict is too large (prevent memory exhaustion)
        if len(_api_key_failures) >= _API_KEY_MAX_TRACKED_IPS:
            _purge_expired_api_key_failures()
        if caller_ip not in _api_key_failures:
            _api_key_failures[caller_ip] = {"failures": 0, "window_start": now}
        _api_key_failures[caller_ip]["failures"] += 1
        log_security_event("API_KEY_FAILURE", {"ip": caller_ip,
            "attempts": _api_key_failures[caller_ip]["failures"]})
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing API Key"
        )

    # Successful auth — clear any failure record
    _api_key_failures.pop(caller_ip, None)
    return api_key


def sanitize_string(input_str: str, max_length: int = 500) -> str:
    """
    Sanitize string input to prevent NoSQL injection and XSS
    
    - Remove MongoDB operators ($, {, })
    - Strip dangerous characters
    - Limit length
    - Escape special regex characters
    """
    if not input_str:
        return ""

    # Normalize Unicode to prevent homograph/bypass attacks (NFC canonical form)
    sanitized = unicodedata.normalize('NFC', str(input_str)).strip()
    
    # Limit length
    sanitized = sanitized[:max_length]
    
    # Remove MongoDB operators and special characters
    # Remove: $ { } [ ] < > | & ` \ " '
    dangerous_chars = ['$', '{', '}', '[', ']', '<', '>', '|', '&', '`', '\\', "'", '"']
    for char in dangerous_chars:
        sanitized = sanitized.replace(char, '')
    
    # Remove MongoDB query operators if they somehow got through
    mongo_operators = [
        '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
        '$in', '$nin', '$and', '$or', '$not', '$nor',
        '$exists', '$type', '$regex', '$where', '$expr'
    ]
    for operator in mongo_operators:
        sanitized = sanitized.replace(operator, '')
    
    return sanitized


def sanitize_lead_id(lead_id: str) -> str:
    """
    Strict sanitization for Lead ID
    Only allow: alphanumeric, hyphens, underscores
    """
    if not lead_id:
        raise ValueError("Lead ID cannot be empty")
    
    # Only allow alphanumeric, hyphens, underscores
    sanitized = re.sub(r'[^a-zA-Z0-9\-_]', '', lead_id)
    
    if len(sanitized) == 0:
        raise ValueError("Lead ID contains only invalid characters")
    
    if len(sanitized) > 100:
        raise ValueError("Lead ID too long (max 100 characters)")
    
    return sanitized


def sanitize_email(email: str) -> str:
    """
    Sanitize email address
    """
    if not email:
        raise ValueError("Email cannot be empty")
    
    # Basic email validation
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, email):
        raise ValueError("Invalid email format")
    
    # Remove any suspicious characters
    sanitized = sanitize_string(email, max_length=255)
    
    if len(sanitized) > 255:
        raise ValueError("Email too long")
    
    return sanitized.lower()


def validate_request_size(content: dict, max_size_kb: int = 50) -> bool:
    """
    Validate request payload size to prevent large payloads
    """
    import sys
    size_bytes = sys.getsizeof(str(content))
    size_kb = size_bytes / 1024
    
    if size_kb > max_size_kb:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Request payload too large (max {max_size_kb}KB)"
        )
    
    return True


class SecurityHeaders:
    """
    Security headers middleware
    """
    @staticmethod
    def get_headers() -> dict:
        return {
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "X-XSS-Protection": "1; mode=block",
            "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
            "Content-Security-Policy": "default-src 'self'",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        }


def log_security_event(event_type: str, details: dict):
    """
    Log security events for monitoring
    """
    logger.warning(f"SECURITY EVENT: {event_type} - {details}")


# IP-based anomaly detection with 1-hour sliding window
class SimpleAnomalyDetector:
    WINDOW_SECONDS = 3600  # Reset counter after 1 hour of inactivity

    def __init__(self):
        self.submission_data = {}  # {identifier: {"count": int, "window_start": float}}

    def check_suspicious_activity(self, identifier: str, threshold: int = 10) -> bool:
        """
        Check if an identifier (IP, Lead ID) has excessive submissions within the window.
        Counters reset automatically after WINDOW_SECONDS, preventing permanent blocks.
        """
        now = time.time()
        entry = self.submission_data.get(identifier)

        if entry is None or now - entry["window_start"] > self.WINDOW_SECONDS:
            # Purge all expired entries to prevent unbounded memory growth
            self.submission_data = {
                k: v for k, v in self.submission_data.items()
                if now - v["window_start"] <= self.WINDOW_SECONDS
            }
            self.submission_data[identifier] = {"count": 1, "window_start": now}
            return False

        entry["count"] += 1
        if entry["count"] > threshold:
            log_security_event("SUSPICIOUS_ACTIVITY", {
                "identifier": identifier,
                "count": entry["count"]
            })
            return True

        return False

anomaly_detector = SimpleAnomalyDetector()
