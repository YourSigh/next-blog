import type { Metadata } from "next";
import AstraParticles from "./AstraParticles";

export const metadata: Metadata = {
  title: "Astra Particle Field",
  description: "An interactive WebGL particle study.",
};

export default function TestPage() {
  return <AstraParticles />;
}
