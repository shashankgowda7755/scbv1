#!/bin/bash

# Security Testing Script for Communitree Lead API
# Tests for common vulnerabilities

API_URL=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2 | tr -d '"')
API_KEY="${API_KEY:-YOUR_API_KEY_HERE}"

echo "🔒 SECURITY TESTING - Communitree Lead API"
echo "=========================================="
echo "API URL: $API_URL"
echo ""

# Test 1: NoSQL Injection Protection
echo "TEST 1: NoSQL Injection Protection"
echo "-----------------------------------"
echo "Attempting MongoDB operator injection..."
RESULT=$(curl -s -X POST "$API_URL/api/check" \
  -H "Content-Type: application/json" \
  -d '{"leadId": {"$ne": null}}' 2>&1)
echo "Response: $RESULT"
if echo "$RESULT" | grep -q "error\|invalid\|422"; then
    echo "✅ PASS: Injection attempt blocked"
else
    echo "❌ FAIL: Injection might be possible"
fi
echo ""

# Test 2: Input Sanitization
echo "TEST 2: Input Sanitization"
echo "-----------------------------------"
echo "Testing special characters removal..."
RESULT=$(curl -s -X POST "$API_URL/api/check" \
  -H "Content-Type: application/json" \
  -d '{"leadId": "$test{injection}<script>"}' 2>&1)
echo "Response: $RESULT"
if echo "$RESULT" | grep -q "testinjectionscript\|error"; then
    echo "✅ PASS: Special characters sanitized"
else
    echo "⚠️  WARNING: Check sanitization"
fi
echo ""

# Test 3: XSS Protection
echo "TEST 3: XSS Protection"  
echo "-----------------------------------"
echo "Testing XSS payload..."
RESULT=$(curl -s -X POST "$API_URL/api/submit" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "leadId": "XSS-TEST",
      "email": "test@test.com",
      "fullName": "<script>alert(1)</script>",
      "phone": "123",
      "company": "Test",
      "orgName": "Test"
    },
    "replace": false
  }' 2>&1)
echo "Response: $RESULT"
if echo "$RESULT" | grep -q "<script>" ; then
    echo "❌ FAIL: XSS payload not sanitized"
else
    echo "✅ PASS: XSS payload blocked or sanitized"
fi
echo ""

# Test 4: Large Payload (DoS)
echo "TEST 4: Large Payload Protection"
echo "-----------------------------------"
echo "Testing oversized payload..."
LARGE_STRING=$(python3 -c "print('A' * 100000)")
RESULT=$(curl -s -X POST "$API_URL/api/submit" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"leadId\":\"TEST\",\"email\":\"test@test.com\",\"fullName\":\"$LARGE_STRING\",\"phone\":\"123\",\"company\":\"Test\",\"orgName\":\"Test\"},\"replace\":false}" \
  --max-time 5 2>&1)
if echo "$RESULT" | grep -q "413\|too large\|error"; then
    echo "✅ PASS: Large payload rejected"
else
    echo "⚠️  WARNING: Large payload might be accepted"
fi
echo ""

# Test 5: API Key Protection (if enabled)
echo "TEST 5: API Key Protection"
echo "-----------------------------------"
echo "Testing /api/leads without API key..."
RESULT=$(curl -s -w "%{http_code}" -o /dev/null "$API_URL/api/leads")
if [ "$RESULT" = "403" ] || [ "$RESULT" = "401" ]; then
    echo "✅ PASS: API key required (HTTP $RESULT)"
elif [ "$RESULT" = "200" ]; then
    echo "⚠️  WARNING: No API key required (development mode?)"
else
    echo "Response code: $RESULT"
fi
echo ""

# Test 6: CORS Configuration
echo "TEST 6: CORS Configuration"
echo "-----------------------------------"
echo "Testing CORS from evil.com..."
RESULT=$(curl -s -H "Origin: https://evil.com" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS "$API_URL/api/submit" \
     -i 2>&1 | grep -i "access-control-allow-origin")
if echo "$RESULT" | grep -q "evil.com"; then
    echo "❌ FAIL: CORS allows evil.com"
elif [ -z "$RESULT" ]; then
    echo "✅ PASS: CORS blocks evil.com"
else
    echo "CORS Header: $RESULT"
fi
echo ""

# Test 7: SQL Injection (N/A for MongoDB, but test anyway)
echo "TEST 7: SQL Injection Attempts (NoSQL)"
echo "-----------------------------------"
echo "Testing SQL-like injection..."
RESULT=$(curl -s -X POST "$API_URL/api/check" \
  -H "Content-Type: application/json" \
  -d '{"leadId": "TEST OR 1=1"}' 2>&1)
if echo "$RESULT" | grep -q "error\|invalid"; then
    echo "✅ PASS: SQL-like injection blocked"
else
    echo "⚠️  Check: $RESULT"
fi
echo ""

# Test 8: Email Validation
echo "TEST 8: Email Validation"
echo "-----------------------------------"
echo "Testing invalid email format..."
RESULT=$(curl -s -X POST "$API_URL/api/submit" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "leadId": "EMAIL-TEST",
      "email": "not-an-email",
      "fullName": "Test",
      "phone": "123",
      "company": "Test",
      "orgName": "Test"
    },
    "replace": false
  }' 2>&1)
if echo "$RESULT" | grep -q "error\|invalid\|422"; then
    echo "✅ PASS: Invalid email rejected"
else
    echo "❌ FAIL: Invalid email accepted"
fi
echo ""

# Test 9: Required Fields
echo "TEST 9: Required Fields Validation"
echo "-----------------------------------"
echo "Testing missing required field..."
RESULT=$(curl -s -X POST "$API_URL/api/submit" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "leadId": "MISSING-TEST",
      "email": "test@test.com"
    },
    "replace": false
  }' 2>&1)
if echo "$RESULT" | grep -q "error\|required\|422"; then
    echo "✅ PASS: Missing fields rejected"
else
    echo "❌ FAIL: Missing fields accepted"
fi
echo ""

# Test 10: HTTPS (if deployed)
echo "TEST 10: HTTPS Configuration"
echo "-----------------------------------"
if echo "$API_URL" | grep -q "https://"; then
    echo "✅ PASS: Using HTTPS"
    # Test TLS version
    TLS_VERSION=$(curl -sI "$API_URL/api/" 2>&1 | grep -i "HTTP")
    echo "TLS Info: $TLS_VERSION"
else
    echo "⚠️  WARNING: Using HTTP (not secure for production)"
fi
echo ""

echo "=========================================="
echo "🔒 SECURITY TEST COMPLETE"
echo "=========================================="
echo ""
echo "RECOMMENDATIONS:"
echo "1. Review any FAIL or WARNING results"
echo "2. Update CORS_ORIGINS in production"
echo "3. Enable API key protection for sensitive endpoints"
echo "4. Use HTTPS in production"
echo "5. Set up rate limiting"
echo "6. Enable MongoDB authentication"
echo "7. Monitor logs for suspicious activity"
echo ""
echo "See SECURITY_GUIDE.md for detailed recommendations"
