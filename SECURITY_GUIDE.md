# 🔒 SECURITY GUIDE - Communitree Lead API

## ✅ CURRENT SECURITY STATUS

### **What's Secure:**
1. ✅ **Pydantic Validation** - Type checking, email validation
2. ✅ **Environment Variables** - No hardcoded credentials
3. ✅ **MongoDB Proper Usage** - No ObjectId exposure
4. ✅ **HTTPS Ready** - Works with TLS/SSL
5. ✅ **Input Length Limits** - Fields have max lengths

---

## ⚠️ SECURITY VULNERABILITIES & FIXES

### **1. NoSQL Injection Protection**

**Vulnerability:** User input directly used in MongoDB queries
**Risk Level:** HIGH

**How NoSQL Injection Works:**
```javascript
// Malicious input:
leadId = {"$ne": null}  // Returns all documents!

// Or:
leadId = {"$gt": ""}    // Bypasses authentication
```

**✅ FIX APPLIED:**
- Added `security.py` with input sanitization
- `sanitize_lead_id()` removes MongoDB operators ($, {, })
- Only allows alphanumeric, hyphens, underscores
- Validates all text fields

**Usage:**
```python
from security import sanitize_lead_id

# Before query
safe_lead_id = sanitize_lead_id(user_input)
result = await db.leads.find_one({"_id": safe_lead_id})
```

---

### **2. Rate Limiting (DDoS Protection)**

**Vulnerability:** No rate limits - can spam submissions
**Risk Level:** HIGH

**Attack Scenario:**
```bash
# Attacker floods API with requests
while true; do
  curl -X POST /api/submit -d '...'
done
# Result: Server overload, service disruption
```

**✅ FIX APPLIED:**
- Installed `slowapi` for rate limiting
- Limits: 10 requests per minute per IP

**Configuration:**
```python
from slowapi import Limiter

limiter = Limiter(key_func=get_remote_address)

@api_router.post("/submit")
@limiter.limit("10/minute")  # Max 10 submissions per minute
async def submit_lead(request: Request):
    ...
```

---

### **3. CORS Configuration**

**Vulnerability:** `CORS_ORIGINS="*"` allows ANY domain
**Risk Level:** MEDIUM

**Attack Scenario:**
```html
<!-- Malicious website: evil.com -->
<script>
  // Can call your API from their site!
  fetch('https://your-api.com/api/leads')
    .then(data => stealData(data))
</script>
```

**✅ FIX:**
Update `.env`:
```bash
# BEFORE (insecure):
CORS_ORIGINS="*"

# AFTER (secure):
CORS_ORIGINS="https://yourdomain.com,https://www.yourdomain.com"
```

---

### **4. API Authentication**

**Vulnerability:** No authentication - anyone can access
**Risk Level:** HIGH

**Attack Scenario:**
```bash
# Anyone can view all leads:
curl https://your-api.com/api/leads

# Result: Data breach!
```

**✅ FIX OPTIONS:**

**Option A: API Key (Simple)**
```python
from security import verify_api_key

@api_router.get("/leads")
async def get_leads(api_key: str = Depends(verify_api_key)):
    # Only accessible with valid API key
    ...
```

**Setup:**
```bash
# In .env:
API_KEY="your-secret-key-here-min-32-chars"

# Usage:
curl -H "X-API-Key: your-secret-key-here" /api/leads
```

**Option B: JWT Tokens (Advanced)**
```python
# User login → Get token → Use token for requests
# More secure, supports user sessions
```

---

### **5. Request Size Limits**

**Vulnerability:** No payload size limits
**Risk Level:** MEDIUM

**Attack Scenario:**
```bash
# Send 1GB request to crash server
curl -X POST /api/submit \
  -d '{"company": "A" * 1000000000}'
```

**✅ FIX APPLIED:**
```python
from security import validate_request_size

@api_router.post("/submit")
async def submit_lead(request: SubmitRequest):
    validate_request_size(request.dict(), max_size_kb=50)
    ...
```

---

### **6. Error Message Information Disclosure**

**Vulnerability:** Detailed error messages expose system info
**Risk Level:** MEDIUM

**Example:**
```json
{
  "detail": "MongoDB connection failed at mongodb://user:pass@localhost:27017"
}
// Exposes: Database location, credentials, internal structure
```

**✅ FIX:**
```python
try:
    # Database operation
except Exception as e:
    # DON'T expose internal details
    logger.error(f"Internal error: {str(e)}")
    raise HTTPException(
        status_code=500,
        detail="An error occurred. Please try again later."
    )
```

---

### **7. SQL Injection (Not Applicable)**

**Note:** MongoDB is NoSQL, so traditional SQL injection doesn't apply.
**However:** NoSQL injection is possible (covered in #1)

---

## 🛡️ SECURITY HEADERS

**Added Security Headers:**
```python
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000
Content-Security-Policy: default-src 'self'
```

**What They Do:**
- Prevent MIME sniffing attacks
- Block clickjacking (iframe embedding)
- Enable XSS filter in browsers
- Force HTTPS connections
- Restrict content sources

---

## 🔐 MONGODB SECURITY

### **Connection Security:**

**❌ INSECURE:**
```bash
MONGO_URL="mongodb://localhost:27017"
# No authentication, localhost only
```

**✅ SECURE (MongoDB Atlas):**
```bash
MONGO_URL="mongodb+srv://username:PASSWORD@cluster.mongodb.net/?tls=true&authSource=admin"
```

### **Database Access Control:**

1. **Enable Authentication**
2. **Create Limited User:**
```javascript
// MongoDB Shell
use leads_database
db.createUser({
  user: "leadapp",
  pwd: "STRONG_PASSWORD_HERE",
  roles: [
    { role: "readWrite", db: "leads_database" }
  ]
})
```

3. **Principle of Least Privilege:**
   - App user: Only read/write to `leads` collection
   - No admin privileges
   - No access to other databases

---

## 🔒 GOOGLE SHEETS SECURITY

### **Service Account Best Practices:**

1. **Limit Scope:**
```python
scopes = ['https://www.googleapis.com/auth/spreadsheets']
# Only Sheets access, not Drive, Gmail, etc.
```

2. **Share Sheet with Service Account Only:**
   - Don't make sheet public
   - Only share with service account email
   - Give "Editor" access (not "Owner")

3. **Rotate Credentials:**
   - Change service account key every 90 days
   - Delete old keys from Google Cloud Console

4. **Monitor Access:**
   - Check Google Cloud Console → IAM → Service Accounts → Activity logs

---

## 🚨 SECURITY MONITORING

### **Log Security Events:**

```python
from security import log_security_event

# Log suspicious activity
log_security_event("MULTIPLE_FAILED_SUBMISSIONS", {
    "ip": request.client.host,
    "lead_id": lead_id,
    "attempts": 5
})
```

### **Monitor These Events:**
- Multiple submissions from same IP
- Invalid API key attempts
- Malformed requests (injection attempts)
- Rate limit violations
- Unusual patterns

---

## ✅ SECURITY CHECKLIST

### **Before Production:**

#### **Backend:**
- [ ] Update `CORS_ORIGINS` to specific domain
- [ ] Set strong `API_KEY` (min 32 characters)
- [ ] Enable MongoDB authentication
- [ ] Use MongoDB Atlas (not localhost)
- [ ] Enable HTTPS/TLS
- [ ] Set up rate limiting
- [ ] Add input sanitization
- [ ] Configure security headers
- [ ] Remove debug/verbose logging
- [ ] Set up error monitoring (Sentry)

#### **Frontend:**
- [ ] Update `REACT_APP_BACKEND_URL` to production URL
- [ ] Remove console.log statements
- [ ] Enable HTTPS
- [ ] Add CSP headers
- [ ] Minify and obfuscate code

#### **Database:**
- [ ] Enable authentication
- [ ] Use strong passwords (min 16 chars)
- [ ] Whitelist specific IPs (not 0.0.0.0/0)
- [ ] Enable encryption at rest
- [ ] Set up automated backups
- [ ] Enable audit logging

#### **Google Cloud:**
- [ ] Rotate service account keys
- [ ] Enable 2FA on Google account
- [ ] Set up billing alerts
- [ ] Review IAM permissions
- [ ] Enable audit logs

---

## 🧪 SECURITY TESTING

### **Test for NoSQL Injection:**

```bash
# Test 1: MongoDB operator injection
curl -X POST /api/check \
  -H "Content-Type: application/json" \
  -d '{"leadId": {"$ne": null}}'
# Expected: Error or sanitized input

# Test 2: Malicious characters
curl -X POST /api/check \
  -H "Content-Type: application/json" \
  -d '{"leadId": "$test{injection}"}' 
# Expected: Sanitized to "testinjection"
```

### **Test Rate Limiting:**

```bash
# Send 20 requests in 10 seconds
for i in {1..20}; do
  curl -X POST /api/submit -d '...' &
done
# Expected: 429 Too Many Requests after 10 requests
```

### **Test CORS:**

```bash
curl -H "Origin: https://evil.com" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS /api/submit
# Expected: CORS error if evil.com not in CORS_ORIGINS
```

### **Test API Key:**

```bash
# Without API key
curl /api/leads
# Expected: 403 Forbidden

# With invalid key
curl -H "X-API-Key: wrong-key" /api/leads
# Expected: 403 Forbidden

# With valid key
curl -H "X-API-Key: correct-key" /api/leads
# Expected: 200 OK with data
```

---

## 🔄 SECURITY MAINTENANCE

### **Monthly:**
- Review access logs for suspicious activity
- Check for failed authentication attempts
- Update dependencies (`pip install --upgrade`)
- Review MongoDB access logs

### **Quarterly:**
- Rotate API keys
- Rotate MongoDB passwords
- Rotate Google service account keys
- Security audit and penetration testing
- Review and update CORS origins

### **Annually:**
- Full security assessment
- Update TLS/SSL certificates
- Review and update security policies
- Staff security training

---

## 📞 INCIDENT RESPONSE

### **If Security Breach Detected:**

1. **Immediate Actions:**
   - Shut down affected service
   - Rotate ALL credentials
   - Enable maintenance mode
   - Preserve logs for analysis

2. **Investigation:**
   - Review logs for attack vector
   - Identify compromised data
   - Assess damage scope
   - Document timeline

3. **Recovery:**
   - Patch vulnerabilities
   - Restore from clean backup
   - Implement additional controls
   - Monitor for 72 hours

4. **Post-Incident:**
   - Notify affected users (if applicable)
   - Update security procedures
   - Train team on lessons learned
   - Implement preventive measures

---

## 📚 ADDITIONAL RESOURCES

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- MongoDB Security Checklist: https://docs.mongodb.com/manual/administration/security-checklist/
- FastAPI Security: https://fastapi.tiangolo.com/tutorial/security/
- Google Cloud Security Best Practices: https://cloud.google.com/security/best-practices

---

## 🎯 QUICK START: Enable All Security Features

Run this script to enable security:

```bash
# 1. Install security dependencies
pip install slowapi python-jose passlib[bcrypt]

# 2. Generate strong API key
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
# Copy output to .env

# 3. Update .env
echo "API_KEY=<generated-key-here>" >> /app/backend/.env
echo "CORS_ORIGINS=https://yourdomain.com" >> /app/backend/.env

# 4. Restart backend
sudo supervisorctl restart backend

# 5. Test security
curl -X POST https://your-api.com/api/check \
  -d '{"leadId": "$test"}'
# Should sanitize input
```

---

**🔒 Security is an ongoing process, not a one-time setup!**
