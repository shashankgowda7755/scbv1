import { useState } from "react";
import "@/App.css";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [formData, setFormData] = useState({
    leadId: "",
    email: "",
    fullName: "",
    phone: "",
    company: "",
    orgName: ""
  });

  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  
  // Duplicate dialog state
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [oldLeadData, setOldLeadData] = useState(null);
  const [pendingSubmission, setPendingSubmission] = useState(null);

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    // Clear messages when user starts typing
    setSuccessMessage("");
    setErrorMessage("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    setLoading(true);
    setSuccessMessage("");
    setErrorMessage("");
    
    try {
      // Step 1: Check if lead exists
      const checkResponse = await axios.post(`${API}/check`, {
        leadId: formData.leadId
      });
      
      if (checkResponse.data.isDuplicate) {
        // Lead exists - fetch old data and show confirmation dialog
        try {
          const oldDataResponse = await axios.get(`${API}/lead/${formData.leadId}`);
          setOldLeadData(oldDataResponse.data.lead);
          setPendingSubmission(formData);
          setShowDuplicateDialog(true);
        } catch (err) {
          // If we can't fetch old data, still show dialog
          setOldLeadData(null);
          setPendingSubmission(formData);
          setShowDuplicateDialog(true);
        }
      } else {
        // No duplicate - submit directly
        await submitLead(formData, false);
      }
    } catch (error) {
      setErrorMessage(error.response?.data?.detail || "Error checking lead. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const submitLead = async (data, replace) => {
    try {
      const response = await axios.post(`${API}/submit`, {
        data: data,
        replace: replace
      });
      
      if (response.data.success) {
        setSuccessMessage("Thank you for submitting!");
        // Clear form
        setFormData({
          leadId: "",
          email: "",
          fullName: "",
          phone: "",
          company: "",
          orgName: ""
        });
      } else {
        setErrorMessage(response.data.message || "Submission failed");
      }
    } catch (error) {
      setErrorMessage(error.response?.data?.detail || "Error submitting lead. Please try again.");
    }
  };

  const handleConfirmReplace = async () => {
    setLoading(true);
    setShowDuplicateDialog(false);
    
    try {
      await submitLead(pendingSubmission, true);
    } catch (error) {
      setErrorMessage("Error replacing lead. Please try again.");
    } finally {
      setLoading(false);
      setPendingSubmission(null);
      setOldLeadData(null);
    }
  };

  const handleCancelReplace = () => {
    setShowDuplicateDialog(false);
    setPendingSubmission(null);
    setOldLeadData(null);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent mb-3">
            Communitree Lead Form
          </h1>
          <p className="text-gray-600 text-lg">Submit your information below</p>
        </div>

        {/* Success Message */}
        {successMessage && (
          <Alert className="mb-6 border-green-500 bg-green-50" data-testid="success-message">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <AlertDescription className="text-green-700 font-medium text-lg">
              {successMessage}
            </AlertDescription>
          </Alert>
        )}

        {/* Error Message */}
        {errorMessage && (
          <Alert className="mb-6 border-red-500 bg-red-50" data-testid="error-message">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <AlertDescription className="text-red-700">
              {errorMessage}
            </AlertDescription>
          </Alert>
        )}

        {/* Main Form Card */}
        <Card className="shadow-xl" data-testid="lead-form-card">
          <CardHeader>
            <CardTitle className="text-2xl">Lead Information</CardTitle>
            <CardDescription>Please fill in all the required fields</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="leadId" className="text-base">Lead ID *</Label>
                <Input
                  id="leadId"
                  name="leadId"
                  data-testid="lead-id-input"
                  placeholder="e.g., LEAD-2024-001"
                  value={formData.leadId}
                  onChange={handleInputChange}
                  required
                  className="text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-base">Email *</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  data-testid="email-input"
                  placeholder="john@example.com"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  className="text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fullName" className="text-base">Full Name *</Label>
                <Input
                  id="fullName"
                  name="fullName"
                  data-testid="fullname-input"
                  placeholder="John Doe"
                  value={formData.fullName}
                  onChange={handleInputChange}
                  required
                  className="text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-base">Phone Number *</Label>
                <Input
                  id="phone"
                  name="phone"
                  data-testid="phone-input"
                  placeholder="+1-234-567-8900"
                  value={formData.phone}
                  onChange={handleInputChange}
                  required
                  className="text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="company" className="text-base">Company *</Label>
                <Input
                  id="company"
                  name="company"
                  data-testid="company-input"
                  placeholder="Acme Inc."
                  value={formData.company}
                  onChange={handleInputChange}
                  required
                  className="text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="orgName" className="text-base">Organization Name *</Label>
                <Input
                  id="orgName"
                  name="orgName"
                  data-testid="orgname-input"
                  placeholder="Marketing Team"
                  value={formData.orgName}
                  onChange={handleInputChange}
                  required
                  className="text-base"
                />
              </div>

              <Button 
                type="submit" 
                disabled={loading}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white py-6 text-lg font-semibold shadow-lg"
                data-testid="submit-button"
              >
                {loading ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Processing...</>
                ) : (
                  "Submit Lead"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Duplicate Confirmation Dialog */}
        <AlertDialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
          <AlertDialogContent className="max-w-2xl" data-testid="duplicate-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-2xl">
                <AlertTriangle className="h-6 w-6 text-orange-600" />
                Duplicate Lead Detected
              </AlertDialogTitle>
              <AlertDialogDescription className="text-base space-y-4">
                <p className="text-gray-700">
                  You have already submitted a lead with this ID. Do you want to replace your old entry?
                </p>
                <p className="text-red-600 font-medium">
                  ⚠️ If you submit this form, your old entry will be deleted, and this will be the final entry.
                </p>
                
                {oldLeadData && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h4 className="font-semibold text-gray-900 mb-3">Your Previous Submission:</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><strong>Lead ID:</strong> {oldLeadData.leadId}</div>
                      <div><strong>Email:</strong> {oldLeadData.email}</div>
                      <div><strong>Name:</strong> {oldLeadData.fullName}</div>
                      <div><strong>Phone:</strong> {oldLeadData.phone}</div>
                      <div><strong>Company:</strong> {oldLeadData.company}</div>
                      <div><strong>Organization:</strong> {oldLeadData.orgName}</div>
                      <div className="col-span-2 text-gray-500 mt-2">
                        <strong>Submitted on:</strong> {new Date(oldLeadData.submittedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={handleCancelReplace}
                className="px-6"
                data-testid="cancel-replace-button"
              >
                No, Don't Submit
              </Button>
              <Button
                onClick={handleConfirmReplace}
                className="bg-emerald-600 hover:bg-emerald-700 px-6"
                data-testid="confirm-replace-button"
              >
                Yes, Submit
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export default App;
