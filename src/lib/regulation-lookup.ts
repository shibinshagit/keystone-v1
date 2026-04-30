import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  getRegulationCollectionNameForMarket,
  shouldUseNationalIndiaFallback,
} from "@/lib/regulation-collections";
import type { BuildingIntendedUse, GeographyMarket, RegulationData } from "@/lib/types";

export interface RegulationLookupResult {
  regulation: RegulationData | null;
  matchedLocation: string | null;
  source:
    | "specific-id"
    | "generic-id"
    | "location-query"
    | "national-fallback"
    | "not-found";
}

function normalizeIntendedUse(intendedUse: string): string {
  const value = intendedUse.trim();
  if (value.toLowerCase() === "mixed use") return "Mixed-Use";
  if (value.toLowerCase() === "mixed-use") return "Mixed Use";
  return value;
}

function buildLocationCandidates(location: string): string[] {
  const cleaned = location.trim();
  if (!cleaned) return ["Delhi"];

  const parts = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(india|usa|us|uae)$/i.test(part));

  return Array.from(
    new Set([
      cleaned,
      ...parts,
      ...(parts.length > 1 ? [parts[parts.length - 1], parts[0]] : []),
    ]),
  );
}

function findBestMatch(
  regulations: RegulationData[],
  intendedUse: string,
): RegulationData | null {
  const normalized = intendedUse.toLowerCase().replace(/-/g, " ");

  return (
    regulations.find(
      (reg) => reg.type?.toLowerCase() === intendedUse.toLowerCase(),
    ) ||
    regulations.find(
      (reg) => reg.type?.toLowerCase().replace(/-/g, " ") === normalized,
    ) ||
    regulations.find((reg) =>
      reg.type?.toLowerCase().includes(normalized),
    ) ||
    regulations[0] ||
    null
  );
}

export async function getAvailableRegulationsForLocation({
  location,
  market,
}: {
  location: string;
  market?: GeographyMarket;
}): Promise<RegulationData[]> {
  if (!location.trim()) return [];

  const collectionName = getRegulationCollectionNameForMarket(market);
  const locationQuery = query(
    collection(db, collectionName),
    where("location", "==", location),
  );
  const snapshot = await getDocs(locationQuery);
  const firestoreRegulations = snapshot.docs.map(
    (entry) =>
      ({
        id: entry.id,
        ...entry.data(),
      }) as RegulationData,
  );

  if (firestoreRegulations.length > 0) {
    return firestoreRegulations;
  }

  return [];
}

export async function lookupRegulationForLocationAndUse({
  location,
  intendedUse,
  regulationId,
  market,
}: {
  location: string;
  intendedUse: BuildingIntendedUse | string;
  regulationId?: string;
  market?: GeographyMarket;
}): Promise<RegulationLookupResult> {
  const normalizedUse = normalizeIntendedUse(String(intendedUse || "Residential"));
  const locationCandidates = buildLocationCandidates(location);
  const collectionName = getRegulationCollectionNameForMarket(market);

  if (regulationId) {
    const specificDoc = await getDoc(doc(db, collectionName, regulationId));
    if (specificDoc.exists()) {
      const regulation = specificDoc.data() as RegulationData;
      return {
        regulation,
        matchedLocation: regulation.location || locationCandidates[0] || null,
        source: "specific-id",
      };
    }

    for (const candidate of locationCandidates) {
      const regulations = await getAvailableRegulationsForLocation({
        location: candidate,
        market,
      });
      const matchedBaseline = regulations.find((reg) => reg.id === regulationId);
      if (matchedBaseline) {
        return {
          regulation: matchedBaseline,
          matchedLocation: candidate,
          source: "specific-id",
        };
      }
    }
  }

  for (const candidate of locationCandidates) {
    const genericDoc = await getDoc(doc(db, collectionName, `${candidate}-${normalizedUse}`));
    if (genericDoc.exists()) {
      const regulation = genericDoc.data() as RegulationData;
      return {
        regulation,
        matchedLocation: candidate,
        source: "generic-id",
      };
    }
  }

  for (const candidate of locationCandidates) {
    const regulations = await getAvailableRegulationsForLocation({
      location: candidate,
      market,
    });
    if (regulations.length === 0) continue;

    const bestMatch = findBestMatch(regulations, normalizedUse);
    if (bestMatch) {
      return {
        regulation: bestMatch,
        matchedLocation: candidate,
        source: "location-query",
      };
    }
  }

  if (!shouldUseNationalIndiaFallback(market)) {
    return {
      regulation: null,
      matchedLocation: null,
      source: "not-found",
    };
  }

  const nationalQuery = query(
    collection(db, collectionName),
    where("location", "==", "National (NBC)"),
  );
  const nationalSnapshot = await getDocs(nationalQuery);
  if (!nationalSnapshot.empty) {
    const regulations = nationalSnapshot.docs.map(
      (entry) => entry.data() as RegulationData,
    );
    const bestMatch = findBestMatch(regulations, normalizedUse);
    if (bestMatch) {
      return {
        regulation: bestMatch,
        matchedLocation: "National (NBC)",
        source: "national-fallback",
      };
    }
  }

  return {
    regulation: null,
    matchedLocation: null,
    source: "not-found",
  };
}
