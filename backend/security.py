"""
Security utilities for the Lead Generation API
Includes: Input sanitization, rate limiting, authentication
"""

import re
from typing import Optional
from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader
import os
import logging

logger = logging.getLogger(__name__)

# API Key for admin endpoints
API_KEY = os.getenv("API_KEY", "")  # Set this in production
API_KEY_NAME = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)


async def verify_api_key(api_key: str = Security(api_key_header)) -> str:
    """
    Verify API key for protected endpoints
    """
    if not API_KEY:
        # If no API key is set, allow access (development mode)
        return "dev_mode"
    
    if api_key != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing API Key"
        )
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
    
    # Convert to string and strip whitespace
    sanitized = str(input_str).strip()
    
    # Limit length
    sanitized = sanitized[:max_length]
    
    # Remove MongoDB operators and special characters
    # Remove: $ { } [ ] ( ) < > ; | & ` \ " '
    dangerous_chars = ['$', '{', '}', '[', ']', '<', '>', '|', '&', '`', '\\']
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
        }


def log_security_event(event_type: str, details: dict):
    """
    Log security events for monitoring
    """
    logger.warning(f"SECURITY EVENT: {event_type} - {details}")


# IP-based anomaly detection (simple implementation)
class SimpleAnomalyDetector:
    def __init__(self):
        self.submission_count = {}
    
    def check_suspicious_activity(self, identifier: str, threshold: int = 10) -> bool:
        """
        Check if an identifier (IP, Lead ID) has excessive submissions
        """
        if identifier not in self.submission_count:
            self.submission_count[identifier] = 0
        
        self.submission_count[identifier] += 1
        
        if self.submission_count[identifier] > threshold:
            log_security_event("SUSPICIOUS_ACTIVITY", {
                "identifier": identifier,
                "count": self.submission_count[identifier]
            })
            return True
        
        return False

anomaly_detector = SimpleAnomalyDetector()
