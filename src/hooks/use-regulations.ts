import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Project, RegulationData, GreenRegulationData, VastuRegulationData } from '@/lib/types';
import { useBuildingStore } from '@/hooks/use-building-store';
import ultimateVastu from '@/data/ultimate-vastu-checklist.json';
import { lookupRegulationForLocationAndUse } from '@/lib/regulation-lookup';

interface UseRegulationsReturn {
    regulations: RegulationData | null;
    greenStandards: GreenRegulationData | null;
    vastuRules: VastuRegulationData | null;
    isLoading: boolean;
}

export function useRegulations(project: Project | null): UseRegulationsReturn {
    const [regulations, setRegulations] = useState<RegulationData | null>(null);
    const [greenStandards, setGreenStandards] = useState<GreenRegulationData | null>(null);
    const [vastuRules, setVastuRules] = useState<VastuRegulationData | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Subscribe to building store project-level overrides (so admin actions in the store reflect here)
    const storeProject = useBuildingStore(state => project ? state.projects.find(p => p.id === project.id) : null);

    useEffect(() => {

        if (!project) return;

        const fetchData = async () => {
            setIsLoading(true);
            // Reset states to ensure clean slate on project change
            setRegulations(null);
            setGreenStandards(null);
            setVastuRules(null);

            try {
                // 1. Fetch Building Regulations
                // Priority: Specific Regulation ID > Generic ID > Smart Fallback
                // Parse location safely since it might be an object
                let location = project.city || project.locationLabel || project.stateOrProvince || 'Delhi';
                if (typeof project.location === 'string') {
                    location = project.city || project.locationLabel || project.location;
                } else if (project.location && typeof project.location === 'object') {
                    // If it's a coordinate object without a resolved string name, we'll have to rely on smart fallback or NBC
                    location = project.city || project.locationLabel || (project.location as any).name || (project.location as any).text || 'Default';
                }
                
                let intendedUse = project.intendedUse || 'Residential';
                // Normalize Mixed Use to deal with hyphenation inconsistencies
                if (intendedUse.toLowerCase() === 'mixed use') intendedUse = 'Mixed-Use';
                else if (intendedUse.toLowerCase() === 'mixed-use') intendedUse = 'Mixed Use';

                const regulationResult = await lookupRegulationForLocationAndUse({
                    location,
                    intendedUse,
                    regulationId: project.regulationId,
                    market: project.market,
                });
                const foundReg = regulationResult.regulation;

                if (foundReg) {
                    setRegulations(foundReg);
                } else {
                    console.warn(`No regulations or NBC fallback found for ${location}`);
                }


                // 2. Fetch Green Regulations
                if (project.greenCertification) {
                    // Handle case where it might be a string (legacy/corrupt data) or array
                    const certs = Array.isArray(project.greenCertification) ? project.greenCertification : [project.greenCertification];

                    if (certs.length > 0) {
                        const certType = certs[0]; // e.g., 'GRIHA'
                        const q = query(collection(db, 'greenRegulations'), where('certificationType', '==', certType));
                        const snapshot = await getDocs(q);
                        if (!snapshot.empty) {
                            setGreenStandards(snapshot.docs[0].data() as GreenRegulationData);
                        }
                    }
                }

                // 3. Fetch Vastu Regulations (attempt regardless of project flag)
                try {
                    const q = query(collection(db, 'vastuRegulations')); // Could filter by Type if needed
                    const snapshot = await getDocs(q);
                    if (!snapshot.empty) {
                        setVastuRules(snapshot.docs[0].data() as VastuRegulationData);
                    } else {
                        // No Vastu rules in Firestore — fall back to the bundled ultimate checklist
                        setVastuRules(ultimateVastu as unknown as VastuRegulationData);
                    }
                } catch (err) {
                    console.error('Error fetching vastu regulations, applying bundled fallback', err);
                    setVastuRules(ultimateVastu as unknown as VastuRegulationData);
                }

            } catch (error) {
                console.error("Error fetching project regulations:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [
        project?.id,
        project?.location,
        project?.intendedUse,
        project?.regulationId, // Add specific ID dependency
        project?.vastuCompliant,
        // Use stringified certifications to prevent infinite loops on array reference change
        JSON.stringify(project?.greenCertification)
    ]);

    // If the building store has an attached vastuRules on the active project, prefer that so admin-loaded checklists take effect immediately
    useEffect(() => {
        try {
            if (storeProject && (storeProject as any).vastuRules) {
                setVastuRules((storeProject as any).vastuRules as VastuRegulationData);
            }
        } catch (e) {
            // ignore
        }
    }, [storeProject]);

    // If the building store has an attached greenStandards on the active project, prefer that so admin uploads apply immediately
    useEffect(() => {
        try {
            if (storeProject && (storeProject as any).greenStandards) {
                setGreenStandards((storeProject as any).greenStandards as GreenRegulationData);
            }
        } catch (e) { /* ignore */ }
    }, [storeProject]);

    return { regulations, greenStandards, vastuRules, isLoading };
}
