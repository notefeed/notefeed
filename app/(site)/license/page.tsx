import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BuyLicense } from "@/components/BuyLicense";
import { freeNoteCap, licensePrice, licensePriceYearly, licensingOn } from "@/backend";

export const metadata: Metadata = { title: "License" };

export const dynamic = "force-dynamic"; // whether licenses are sold is the instance's setting

export default function LicensePage() {
  if (!licensingOn()) notFound(); // self-hosted: everything is open, nothing to buy
  return (
    <main>
      <h1 className="mb-2 text-3xl font-bold tracking-tight">License</h1>
      <BuyLicense price={licensePrice()} yearlyPrice={licensePriceYearly()} cap={freeNoteCap()} />
    </main>
  );
}
