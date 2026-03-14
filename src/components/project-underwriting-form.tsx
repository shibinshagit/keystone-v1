import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Project, UnderwritingData } from '@/lib/types';
import { Plus, Trash2, Printer } from 'lucide-react';
import { useBuildingStore } from '@/hooks/use-building-store';

interface ProjectUnderwritingFormProps {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: UnderwritingData) => void;
  onContinueToPrint: () => void;
  reportType?: 'underwriting' | 'feasibility';
}

export function ProjectUnderwritingForm({ project, isOpen, onClose, onSave, onContinueToPrint, reportType = 'underwriting' }: ProjectUnderwritingFormProps) {
  const [formData, setFormData] = useState<UnderwritingData>(project.underwriting || {});
  const [isPrinting, setIsPrinting] = useState(false);

  const [activeTab, setActiveTab] = useState('borrower');
  const tabs = ['borrower', 'financials', 'legal', 'market'];

  useEffect(() => {
    if (isOpen) {
      setFormData(prev => Object.keys(prev).length > 0 ? prev : (project.underwriting || {}));
      setActiveTab('borrower');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Auto-save to global store + Firebase on change
  useEffect(() => {
    if (isOpen && Object.keys(formData).length > 0) {
      const timer = setTimeout(() => {
        onSave(formData);
        useBuildingStore.getState().actions.updateProject(project.id, { underwriting: formData });
        useBuildingStore.getState().actions.saveCurrentProject();
      }, 800);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, isOpen, project.id]);

  const handleChange = (section: string, field: string, value: any) => {
    setFormData(prev => {
      if (section) {
        return {
          ...prev,
          [section]: {
            ...(prev as any)[section],
            [field]: value
          }
        };
      }
      return { ...prev, [field]: value };
    });
  };

  const handleSaveAndPrint = () => {
    setIsPrinting(true);
    onSave(formData);
    useBuildingStore.getState().actions.updateProject(project.id, { underwriting: formData });
    useBuildingStore.getState().actions.saveCurrentProject();
    onContinueToPrint();
    setTimeout(() => setIsPrinting(false), 2000);
  };

  const addCompetitor = () => {
    const comps = formData.competitors || [];
    setFormData({
      ...formData,
      competitors: [...comps, { name: 'New Project', sellingPricePerSqm: 0, absorptionRate: '0%' }]
    });
  };

  const updateCompetitor = (index: number, field: string, value: any) => {
    const comps = [...(formData.competitors || [])];
    comps[index] = { ...comps[index], [field]: value };
    setFormData({ ...formData, competitors: comps });
  };

  const removeCompetitor = (index: number) => {
    const comps = [...(formData.competitors || [])];
    comps.splice(index, 1);
    setFormData({ ...formData, competitors: comps });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 print:hidden">
        <DialogHeader className="p-6 pb-2 border-b">
          <DialogTitle>Export {reportType === 'feasibility' ? 'Feasibility' : 'Underwriting'} Report</DialogTitle>
          <DialogDescription>
            {reportType === 'feasibility' 
              ? 'Please provide the land cost details for the feasibility computations.'
              : 'Please provide explicit values for the report. These will replace the [TDP] placeholders in the generated PDF.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden min-h-0">
          {reportType === 'feasibility' ? (
            <div className="p-6 space-y-4">
              <h4 className="font-semibold text-sm">Land Economics</h4>
              <div className="space-y-2">
                <Label>Actual Land Purchase Cost (₹)</Label>
                <Input type="number" value={formData.actualLandPurchaseCost || ''} onChange={e => handleChange('', 'actualLandPurchaseCost', parseInt(e.target.value))} placeholder="e.g. 40000000" />
              </div>
              <div className="space-y-2">
                <Label>Stamp Duty & Legal Fees (₹)</Label>
                <Input type="number" value={formData.stampDutyAndLegalFees || ''} onChange={e => handleChange('', 'stampDutyAndLegalFees', parseInt(e.target.value))} placeholder="e.g. 2000000" />
              </div>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full flex flex-col">
            <div className="px-6 pt-2">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="borrower">Borrower</TabsTrigger>
                <TabsTrigger value="financials">Financials</TabsTrigger>
                <TabsTrigger value="legal">Legal Status</TabsTrigger>
                <TabsTrigger value="market">Competitors</TabsTrigger>
              </TabsList>
            </div>

            <ScrollArea className="flex-1 px-6 py-4">
              <TabsContent value="borrower" className="space-y-4 m-0">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Promoter Name (Group)</Label>
                    <Input value={formData.promoterName || ''} onChange={e => handleChange('', 'promoterName', e.target.value)} placeholder="e.g., Keystone Realty Group" />
                  </div>
                  <div className="space-y-2">
                    <Label>Borrower Company Name</Label>
                    <Input value={formData.companyName || ''} onChange={e => handleChange('', 'companyName', e.target.value)} placeholder="e.g., Keystone SPV Developers Pvt. Ltd." />
                  </div>
                  <div className="space-y-2">
                    <Label>Legal Entity Type</Label>
                    <Input value={formData.legalEntity || ''} onChange={e => handleChange('', 'legalEntity', e.target.value)} placeholder="e.g., Private Limited" />
                  </div>
                  <div className="space-y-2">
                    <Label>Credit Rating</Label>
                    <Input value={formData.creditRating || ''} onChange={e => handleChange('', 'creditRating', e.target.value)} placeholder="e.g., CRISIL A+" />
                  </div>
                  <div className="space-y-2">
                    <Label>Years in Real Estate</Label>
                    <Input type="number" value={formData.yearsInRealEstate || ''} onChange={e => handleChange('', 'yearsInRealEstate', parseInt(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Completed Projects</Label>
                    <Input type="number" value={formData.completedProjectsCount || ''} onChange={e => handleChange('', 'completedProjectsCount', parseInt(e.target.value))} />
                  </div>
                  <div className="space-y-2 min-w-full col-span-2">
                    <Label>Management Capability / Track Record Summary</Label>
                    <Input value={formData.managementCapability || ''} onChange={e => handleChange('', 'managementCapability', e.target.value)} placeholder="Strong execution capability, nil defaults..." />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="financials" className="space-y-4 m-0">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Requested Loan Amount (₹)</Label>
                    <Input type="number" value={formData.requestedLoanAmount || ''} onChange={e => handleChange('', 'requestedLoanAmount', parseInt(e.target.value))} placeholder="e.g. 150000000" />
                  </div>
                  <div className="space-y-2">
                    <Label>Promoter's Equity Contribution (₹)</Label>
                    <Input type="number" value={formData.promoterEquity || ''} onChange={e => handleChange('', 'promoterEquity', parseInt(e.target.value))} placeholder="e.g. 50000000" />
                  </div>
                  <div className="space-y-2">
                    <Label>Target Interest Rate (%)</Label>
                    <Input type="number" step="0.1" value={formData.targetInterestRate || ''} onChange={e => handleChange('', 'targetInterestRate', parseFloat(e.target.value))} placeholder="e.g. 10.5" />
                  </div>
                  <div className="space-y-2">
                    <Label>Loan Tenure (Months)</Label>
                    <Input type="number" value={formData.loanTenureMonths || ''} onChange={e => handleChange('', 'loanTenureMonths', parseInt(e.target.value))} placeholder="e.g. 48" />
                  </div>
                  <div className="col-span-2 space-y-2 pt-4 border-t">
                    <h4 className="font-semibold text-sm">Land Economics</h4>
                  </div>
                  <div className="space-y-2">
                    <Label>Actual Land Purchase Cost (₹)</Label>
                    <Input type="number" value={formData.actualLandPurchaseCost || ''} onChange={e => handleChange('', 'actualLandPurchaseCost', parseInt(e.target.value))} placeholder="e.g. 40000000" />
                  </div>
                  <div className="space-y-2">
                    <Label>Stamp Duty & Legal Fees (₹)</Label>
                    <Input type="number" value={formData.stampDutyAndLegalFees || ''} onChange={e => handleChange('', 'stampDutyAndLegalFees', parseInt(e.target.value))} placeholder="e.g. 2000000" />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="legal" className="space-y-4 m-0">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'buildingPlan', label: 'Building Plan Approval' },
                    { key: 'environmentClearance', label: 'Environment Clearance' },
                    { key: 'fireNoc', label: 'Fire NOC' },
                    { key: 'utilityConnections', label: 'Utility Connections' },
                  ].map(item => (
                    <div key={item.key} className="space-y-2">
                      <Label>{item.label}</Label>
                      <Select 
                        value={formData.approvals?.[item.key as keyof typeof formData.approvals] as string || 'Pending'} 
                        onValueChange={val => handleChange('approvals', item.key, val)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Pending">Pending</SelectItem>
                          <SelectItem value="Approved">Approved</SelectItem>
                          <SelectItem value="Not Applicable">Not Applicable</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                  <div className="space-y-2 col-span-2">
                    <Label>RERA Registration Number (or 'Pending')</Label>
                    <Input 
                      value={formData.approvals?.reraRegistration || ''} 
                      onChange={e => handleChange('approvals', 'reraRegistration', e.target.value)} 
                      placeholder="e.g., P51800000000 or Pending" 
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="market" className="space-y-4 m-0">
                <div className="flex justify-between items-center bg-muted/50 p-2 rounded">
                  <span className="text-sm font-medium">Competitor Projects</span>
                  <Button variant="outline" size="sm" onClick={addCompetitor} className="h-7 text-xs">
                    <Plus className="h-3 w-3 mr-1" /> Add Competitor
                  </Button>
                </div>
                
                {(!formData.competitors || formData.competitors.length === 0) ? (
                  <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded">
                    No competitors defined. Dummy placeholders will be printed.
                  </div>
                ) : (
                  formData.competitors.map((comp, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end border p-3 rounded bg-card">
                      <div className="space-y-2">
                        <Label className="text-xs">Project Name</Label>
                        <Input value={comp.name} onChange={e => updateCompetitor(idx, 'name', e.target.value)} className="h-8 text-sm" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Selling Price (₹/sqm)</Label>
                        <Input type="number" value={comp.sellingPricePerSqm} onChange={e => updateCompetitor(idx, 'sellingPricePerSqm', parseInt(e.target.value))} className="h-8 text-sm" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Absorption</Label>
                        <Input value={comp.absorptionRate} onChange={e => updateCompetitor(idx, 'absorptionRate', e.target.value)} className="h-8 text-sm" placeholder="e.g. 70% Sold" />
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeCompetitor(idx)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
          )}
        </div>

        <DialogFooter className="p-4 border-t shrink-0 sm:justify-between w-full">
          <Button variant="outline" onClick={onClose} disabled={isPrinting}>Close</Button>
          
          {reportType === 'feasibility' ? (
            <Button onClick={handleSaveAndPrint} disabled={isPrinting}>
              <Printer className="h-4 w-4 mr-1.5" />
              {isPrinting ? 'Loading...' : 'Print / Save PDF'}
            </Button>
          ) : (
            <div className="flex space-x-2">
              {activeTab !== 'borrower' && (
                <Button variant="outline" onClick={() => {
                  const idx = tabs.indexOf(activeTab);
                  if (idx > 0) setActiveTab(tabs[idx - 1]);
                }}>Back</Button>
              )}
              {activeTab !== 'market' ? (
                <Button onClick={() => {
                  const idx = tabs.indexOf(activeTab);
                  if (idx < tabs.length - 1) setActiveTab(tabs[idx + 1]);
                }}>Next</Button>
              ) : (
                <Button onClick={handleSaveAndPrint} disabled={isPrinting}>
                  <Printer className="h-4 w-4 mr-1.5" />
                  {isPrinting ? 'Loading...' : 'Print Report'}
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
