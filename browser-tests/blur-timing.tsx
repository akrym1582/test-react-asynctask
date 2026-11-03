import React, { useState } from "react";
import { createRoot } from "react-dom/client";

const mode = new URLSearchParams(location.search).get("mode");
function Form() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [blurs, setBlurs] = useState(0);
  async function normalize(raw: string) {
    setBlurs((count) => count + 1);
    if (mode === "microtask") await Promise.resolve();
    if (mode === "timer0" || mode === "timer10") {
      await new Promise((resolve) =>
        setTimeout(resolve, mode === "timer0" ? 0 : 10),
      );
    }
    setValue(raw.toUpperCase());
  }
  return (
    <>
      <input
        aria-label="Name"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={(event) => void normalize(event.currentTarget.value)}
      />
      <button onClick={() => setSaved(value)}>Save</button>
      <output data-testid="saved">{saved}</output>
      <output data-testid="blurs">{blurs}</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Form />);
