import { useState } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Home = () => {
  const [checkLeadId, setCheckLeadId] = useState("");
  const [checkResult, setCheckResult] = useState(null);
  const [checkLoading, setCheckLoading] = useState(false);

  const [formData, setFormData] = useState({
    leadId: "",
    email: "",
    fullName: "",
    phone: "",
    company: "",
    orgName: ""
  });
  const [replace, setReplace] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitLoading, setSubmitLoading] = useState(false);

  const [allLeads, setAllLeads] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(false);

  const handleCheck = async () => {
    if (!checkLeadId.trim()) return;
    
    setCheckLoading(true);
    setCheckResult(null);
    
    try {
      const response = await axios.post(`${API}/check`, {
        leadId: checkLeadId
      });
      setCheckResult(response.data);
    } catch (error) {
      setCheckResult({
        isDuplicate: false,
        error: error.response?.data?.detail || "Error checking lead"
      });
    } finally {
      setCheckLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    setSubmitLoading(true);
    setSubmitResult(null);
    
    try {
      const response = await axios.post(`${API}/submit`, {
        data: formData,
        replace: replace
      });
      setSubmitResult(response.data);
      
      // Clear form on success
      if (response.data.success) {
        setFormData({
          leadId: "",
          email: "",
          fullName: "",
          phone: "",
          company: "",
          orgName: ""
        });
        setReplace(false);
      }
    } catch (error) {
      setSubmitResult({
        success: false,
        message: error.response?.data?.detail || "Error submitting lead"
      });
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const fetchAllLeads = async () => {
    setLeadsLoading(true);
    try {
      const response = await axios.get(`${API}/leads`);
      setAllLeads(response.data.leads || []);
    } catch (error) {
      console.error("Error fetching leads:", error);
    } finally {
      setLeadsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent mb-3">
            Communitree Lead API
          </h1>
          <p className="text-gray-600 text-lg">Lightning-fast lead management with MongoDB</p>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="check" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8">
            <TabsTrigger value="check" data-testid="check-tab">Check Duplicate</TabsTrigger>
            <TabsTrigger value="submit" data-testid="submit-tab">Submit Lead</TabsTrigger>
            <TabsTrigger value="view" data-testid="view-tab">View All Leads</TabsTrigger>
          </TabsList>

          {/* Check Duplicate Tab */}
          <TabsContent value="check">
            <Card data-testid="check-duplicate-card">
              <CardHeader>
                <CardTitle>Check for Duplicate Lead</CardTitle>
                <CardDescription>Enter a Lead ID to check if it already exists (O(1) lookup)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="checkLeadId">Lead ID</Label>
                    <Input
                      id="checkLeadId"
                      data-testid="check-lead-id-input"
                      placeholder="e.g., LEAD-2024-001"
                      value={checkLeadId}
                      onChange={(e) => setCheckLeadId(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleCheck()}
                    />
                  </div>
                  
                  <Button 
                    onClick={handleCheck} 
                    disabled={checkLoading || !checkLeadId.trim()}
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    data-testid="check-button"
                  >
                    {checkLoading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking...</>
                    ) : (
                      "Check Duplicate"
                    )}
                  </Button>

                  {checkResult && (
                    <Alert 
                      className={checkResult.error ? "border-red-500" : checkResult.isDuplicate ? "border-orange-500" : "border-green-500"}
                      data-testid="check-result"
                    >
                      {checkResult.error ? (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      ) : checkResult.isDuplicate ? (
                        <AlertCircle className="h-4 w-4 text-orange-500" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                      <AlertDescription>
                        {checkResult.error ? (
                          <span className="text-red-600">{checkResult.error}</span>
                        ) : checkResult.isDuplicate ? (
                          <span className="text-orange-700">
                            <strong>Duplicate Found!</strong> Lead ID "{checkResult.leadId}" already exists.
                          </span>
                        ) : (
                          <span className="text-green-700">
                            <strong>Available!</strong> Lead ID "{checkResult.leadId}" is not in the system.
                          </span>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Submit Lead Tab */}
          <TabsContent value="submit">
            <Card data-testid="submit-lead-card">
              <CardHeader>
                <CardTitle>Submit New Lead</CardTitle>
                <CardDescription>Add a new lead or replace an existing one</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="leadId">Lead ID *</Label>
                      <Input
                        id="leadId"
                        name="leadId"
                        data-testid="submit-lead-id-input"
                        placeholder="LEAD-2024-001"
                        value={formData.leadId}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="email">Email *</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        data-testid="submit-email-input"
                        placeholder="john@example.com"
                        value={formData.email}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="fullName">Full Name *</Label>
                      <Input
                        id="fullName"
                        name="fullName"
                        data-testid="submit-fullname-input"
                        placeholder="John Doe"
                        value={formData.fullName}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone Number *</Label>
                      <Input
                        id="phone"
                        name="phone"
                        data-testid="submit-phone-input"
                        placeholder="+1-234-567-8900"
                        value={formData.phone}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="company">Company *</Label>
                      <Input
                        id="company"
                        name="company"
                        data-testid="submit-company-input"
                        placeholder="Acme Inc."
                        value={formData.company}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="orgName">Organization Name *</Label>
                      <Input
                        id="orgName"
                        name="orgName"
                        data-testid="submit-orgname-input"
                        placeholder="Marketing Team"
                        value={formData.orgName}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 p-4 bg-gray-50 rounded-lg">
                    <input
                      type="checkbox"
                      id="replace"
                      data-testid="replace-checkbox"
                      checked={replace}
                      onChange={(e) => setReplace(e.target.checked)}
                      className="h-4 w-4 text-emerald-600 focus:ring-emerald-500 border-gray-300 rounded"
                    />
                    <Label htmlFor="replace" className="cursor-pointer">
                      Replace if Lead ID already exists
                    </Label>
                  </div>

                  <Button 
                    type="submit" 
                    disabled={submitLoading}
                    className="w-full bg-teal-600 hover:bg-teal-700"
                    data-testid="submit-button"
                  >
                    {submitLoading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...</>
                    ) : (
                      "Submit Lead"
                    )}
                  </Button>

                  {submitResult && (
                    <Alert 
                      className={submitResult.success ? "border-green-500" : "border-red-500"}
                      data-testid="submit-result"
                    >
                      {submitResult.success ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                      <AlertDescription className={submitResult.success ? "text-green-700" : "text-red-700"}>
                        {submitResult.message}
                      </AlertDescription>
                    </Alert>
                  )}
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* View All Leads Tab */}
          <TabsContent value="view">
            <Card data-testid="view-leads-card">
              <CardHeader>
                <CardTitle>All Leads</CardTitle>
                <CardDescription>View all submitted leads in the database</CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  onClick={fetchAllLeads} 
                  disabled={leadsLoading}
                  className="mb-4 bg-cyan-600 hover:bg-cyan-700"
                  data-testid="fetch-leads-button"
                >
                  {leadsLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</>
                  ) : (
                    "Fetch All Leads"
                  )}
                </Button>

                {allLeads.length > 0 && (
                  <div className="space-y-4" data-testid="leads-list">
                    <div className="flex items-center justify-between mb-4">
                      <Badge variant="secondary" className="text-lg">
                        Total: {allLeads.length} leads
                      </Badge>
                    </div>
                    
                    <div className="space-y-3 max-h-[500px] overflow-y-auto">
                      {allLeads.map((lead, index) => (
                        <div 
                          key={index} 
                          className="p-4 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
                          data-testid={`lead-item-${index}`}
                        >
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div><strong>Lead ID:</strong> {lead.leadId}</div>
                            <div><strong>Email:</strong> {lead.email}</div>
                            <div><strong>Name:</strong> {lead.fullName}</div>
                            <div><strong>Phone:</strong> {lead.phone}</div>
                            <div><strong>Company:</strong> {lead.company}</div>
                            <div><strong>Org:</strong> {lead.orgName}</div>
                            <div className="col-span-2 text-gray-500">
                              <strong>Submitted:</strong> {new Date(lead.submittedAt).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!leadsLoading && allLeads.length === 0 && (
                  <p className="text-center text-gray-500 py-8">No leads found. Click "Fetch All Leads" to load.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;