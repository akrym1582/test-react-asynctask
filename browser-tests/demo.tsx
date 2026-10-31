import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ExampleForm } from "../src/ExampleForm";
function Demo() {
  const [saved, setSaved] = useState("");
  return (
    <>
      <ExampleForm
        normalizeName={async (value) => value.trim().toUpperCase()}
        normalizeAddress={async (value) => value.trim()}
        save={async (value) => setSaved(JSON.stringify(value))}
      />
      <output data-testid="saved">{saved}</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
