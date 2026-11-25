'use client';

import { useState, FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Shield, User, MapPin, Phone, Calendar, HeartPulse } from 'lucide-react';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'];
const splitList = (v: FormDataEntryValue | null) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

interface HealthPermit {
  tokenId: string;
  clinicalHash: string;
  network: string;
  txHash: string;
  soul: string;
}

export default function RegistrationForm() {
  const [status, setStatus] = useState({ message: '', type: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [permit, setPermit] = useState<HealthPermit | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setStatus({ message: 'Registering tourist and minting Digital ID...', type: 'info' });
    setPermit(null);

    const formData = new FormData(event.currentTarget);
    const bloodGroup = String(formData.get('bloodGroup') || '');
    const health = bloodGroup
      ? {
          consent: formData.get('consent') === 'on',
          nationalId: String(formData.get('nationalId') || formData.get('passport') || ''),
          age: Number(formData.get('age')) || undefined,
          bloodGroup,
          allergies: splitList(formData.get('allergies')),
          chronicConditions: splitList(formData.get('conditions')),
          medications: splitList(formData.get('medications')),
          emergencyContacts: formData.get('ecName') && formData.get('ecPhone')
            ? [{ name: String(formData.get('ecName')), phone: String(formData.get('ecPhone')), relationship: String(formData.get('ecRelation') || '') || undefined }]
            : [],
        }
      : undefined;
    const data = {
      kyc: {
        name: formData.get('name'),
        passport: formData.get('passport'),
        nationality: formData.get('nationality'),
      },
      itinerary: (formData.get('itinerary') as string).split(',').map(s => s.trim()),
      emergencyContacts: (formData.get('contacts') as string).split(',').map(s => s.trim()),
      tripDurationDays: Number(formData.get('duration')),
      health,
    };

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Something went wrong');
      }

      setStatus({ 
        message: `Successfully registered tourist! Digital ID: ${result.digitalId}`, 
        type: 'success'
      });
      setPermit(result.healthPermit ?? null);
      (event.target as HTMLFormElement).reset();

    } catch (error: any) {
      setStatus({ message: error.message, type: 'error' });
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {status.message && (
        <Card className={`border-l-4 ${
          status.type === 'success' ? 'border-l-accent bg-accent/5' :
          status.type === 'error' ? 'border-l-destructive bg-destructive/5' :
          'border-l-primary bg-primary/5'
        }`}>
          <CardContent className="p-4">
            <p className={`text-sm font-medium ${
              status.type === 'success' ? 'text-[#112A46]' :
              status.type === 'error' ? 'text-destructive' :
              'text-primary'
            }`}>
              {status.message}
            </p>
          </CardContent>
        </Card>
      )}

      {permit && (
        <Card className="border-l-4 border-l-accent">
          <CardContent className="p-4 space-y-1 text-sm">
            <p className="font-semibold text-foreground flex items-center gap-2"><HeartPulse className="h-4 w-4 text-primary" />Soulbound health permit issued</p>
            <p className="text-muted-foreground break-all">Token ID: {permit.tokenId}</p>
            <p className="text-muted-foreground break-all">Clinical hash: {permit.clinicalHash}</p>
            <p className="text-muted-foreground break-all">Registry: {permit.network} · tx {permit.txHash}</p>
            <p className="text-xs text-muted-foreground">Only these hashes are anchored. The clinical profile is encrypted and reaches the tourist&apos;s phone as a signed Emergency QR.</p>
          </CardContent>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* KYC Details Card */}
          <Card className="bg-gradient-card shadow-card hover:shadow-elegant transition-all duration-300">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-xl">
                <div className="p-2 rounded-lg bg-primary/10">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <span className="text-foreground">KYC Verification</span>
                  <Badge variant="secondary" className="ml-2 text-xs">
                    Step 1
                  </Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  Full Legal Name
                </Label>
                <Input 
                  type="text" 
                  name="name" 
                  id="name" 
                  required 
                  className="bg-background/50 border-border focus:border-primary focus:ring-primary/20" 
                  placeholder="Enter full name as per ID document"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="passport" className="text-sm font-medium text-foreground">
                  Aadhaar / Passport Number
                </Label>
                <Input 
                  type="text" 
                  name="passport" 
                  id="passport" 
                  required 
                  className="bg-background/50 border-border focus:border-primary focus:ring-primary/20" 
                  placeholder="e.g., A1234567 or 1234-5678-9012"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="nationality" className="text-sm font-medium text-foreground">
                  Nationality / Country of Origin
                </Label>
                <Input 
                  type="text" 
                  name="nationality" 
                  id="nationality" 
                  required 
                  className="bg-background/50 border-border focus:border-primary focus:ring-primary/20" 
                  placeholder="e.g., Indian, American, British"
                />
              </div>
            </CardContent>
          </Card>

          {/* Trip Details Card */}
          <Card className="bg-gradient-card shadow-card hover:shadow-elegant transition-all duration-300">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-xl">
                <div className="p-2 rounded-lg bg-primary/10">
                  <MapPin className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <span className="text-foreground">Trip & Safety Details</span>
                  <Badge variant="secondary" className="ml-2 text-xs">
                    Step 2
                  </Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="itinerary" className="text-sm font-medium text-foreground flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  Planned Itinerary
                </Label>
                <Textarea 
                  name="itinerary" 
                  id="itinerary" 
                  rows={3} 
                  required 
                  className="bg-background/50 border-border focus:border-primary focus:ring-primary/20 resize-none" 
                  placeholder="List destinations separated by commas (e.g., Jaipur, Jodhpur, Udaipur, Mount Abu)"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="contacts" className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Phone className="h-4 w-4 text-primary" />
                  Emergency Contacts
                </Label>
                <Input 
                  type="text" 
                  name="contacts" 
                  id="contacts" 
                  required 
                  className="bg-background/50 border-border focus:border-primary focus:ring-primary/20" 
                  placeholder="Phone numbers separated by commas (e.g., +919876543210, +911234567890)"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="duration" className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  Trip Duration (Days)
                </Label>
                <Input 
                  type="number" 
                  name="duration" 
                  id="duration" 
                  required 
                  min="1" 
                  max="365"
                  defaultValue="7" 
                  className="bg-background/50 border-border focus:border-primary focus:ring-primary/20" 
                  placeholder="Number of days (e.g., 7, 14, 30)"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Emergency Health Profile */}
        <Card className="bg-gradient-card shadow-card hover:shadow-elegant transition-all duration-300">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-3 text-xl">
              <div className="p-2 rounded-lg bg-primary/10">
                <HeartPulse className="h-5 w-5 text-primary" />
              </div>
              <div>
                <span className="text-foreground">Emergency Health Profile</span>
                <Badge variant="secondary" className="ml-2 text-xs">Step 3 · optional</Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="bloodGroup" className="text-sm font-medium text-foreground">Blood group</Label>
              <select id="bloodGroup" name="bloodGroup" defaultValue="" className="h-10 w-full rounded-md border border-border bg-background/50 px-3 text-sm">
                <option value="">— skip health profile —</option>
                {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g === 'UNKNOWN' ? 'Unknown' : g}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="age" className="text-sm font-medium text-foreground">Age</Label>
              <Input type="number" name="age" id="age" min="1" max="120" className="bg-background/50 border-border" placeholder="e.g., 34" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nationalId" className="text-sm font-medium text-foreground">National ID for permit</Label>
              <Input type="text" name="nationalId" id="nationalId" className="bg-background/50 border-border" placeholder="Defaults to the passport / Aadhaar above" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="allergies" className="text-sm font-medium text-foreground">Drug / food allergies</Label>
              <Input type="text" name="allergies" id="allergies" className="bg-background/50 border-border" placeholder="Comma separated, e.g., Penicillin" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="conditions" className="text-sm font-medium text-foreground">Chronic conditions</Label>
              <Input type="text" name="conditions" id="conditions" className="bg-background/50 border-border" placeholder="e.g., Asthma, Type 1 diabetes" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="medications" className="text-sm font-medium text-foreground">Current medications</Label>
              <Input type="text" name="medications" id="medications" className="bg-background/50 border-border" placeholder="e.g., Insulin, Salbutamol" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ecName" className="text-sm font-medium text-foreground">Next of kin</Label>
              <Input type="text" name="ecName" id="ecName" className="bg-background/50 border-border" placeholder="Full name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ecPhone" className="text-sm font-medium text-foreground">Next of kin phone</Label>
              <Input type="tel" name="ecPhone" id="ecPhone" className="bg-background/50 border-border" placeholder="+91…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ecRelation" className="text-sm font-medium text-foreground">Relationship</Label>
              <Input type="text" name="ecRelation" id="ecRelation" className="bg-background/50 border-border" placeholder="e.g., Spouse" />
            </div>
            <label className="md:col-span-3 flex items-start gap-3 text-sm text-muted-foreground">
              <input type="checkbox" name="consent" className="mt-1 h-4 w-4" />
              <span>
                The tourist consents to this health information being encrypted and used only for emergency medical response
                (Digital Personal Data Protection Act 2023). Only a cryptographic hash goes on the permit registry, and only
                authorised first responders can decrypt the profile. Required when a blood group is selected.
              </span>
            </label>
          </CardContent>
        </Card>

        {/* Security Notice */}
        <Card className="bg-gradient-feature border-primary/20">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground">Digital ID Security</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your digital ID will be generated using blockchain-verified technology ensuring data integrity and security. 
                  This information is encrypted and used solely for safety monitoring and emergency response purposes.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submit Button */}
        <div className="flex justify-center pt-4">
          <Button 
            type="submit" 
            disabled={isLoading}
            variant="hero"
            size="lg"
            className="min-w-[200px]"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Shield className="mr-2 h-4 w-4" />
                Generate Digital ID
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}