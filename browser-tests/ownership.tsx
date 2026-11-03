import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AfterTasksProvider, useAfterTasks } from "../src/AfterTasks";

type Gate = { id: string; finish: () => void };

function Owner({
  name,
  addGate,
  record,
}: {
  name: string;
  addGate: (gate: Gate) => void;
  record: (event: string) => void;
}) {
  const { registerAsyncTask } = useAfterTasks();
  function start(background: boolean) {
    const id = name + (background ? "-background" : "");
    registerAsyncTask(
      async ({ signal }) => {
        signal.addEventListener("abort", () => record("abort " + id));
        // Deliberately ignore abort and deliver the result after navigation.
        await new Promise<void>((finish) => addGate({ id, finish }));
        record("returned " + id);
        return id;
      },
      {
        key: background ? id : "shared",
        blocking: !background,
        onCommit: (value) => record("commit " + value),
      },
    );
  }
  return (
    <section>
      <button onClick={() => start(false)}>Start {name}</button>
      <button onClick={() => start(true)}>Background {name}</button>
      <button
        onClick={() =>
          registerAsyncTask(
            () => {
              throw new Error(name);
            },
            { key: "shared" },
          )
        }
      >
        Fail {name}
      </button>
    </section>
  );
}

function Fixture() {
  const [visit, setVisit] = useState(1);
  const [open, setOpen] = useState(true);
  const [peer, setPeer] = useState(true);
  const [gates, setGates] = useState<Gate[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const record = (event: string) => setEvents((all) => [...all, event]);
  const addGate = (gate: Gate) => setGates((all) => [...all, gate]);
  const { runAfterTasks, isRunning, hasPendingTasks } = useAfterTasks(
    () => record("saved"),
    {
      onError: (error) => {
        const cause =
          error instanceof AggregateError ? error.errors[0]?.cause : error;
        record("error " + String(cause));
      },
    },
  );
  return (
    <>
      {open && <Owner name={"screen-" + visit} {...{ addGate, record }} />}
      {peer && <Owner name="peer" {...{ addGate, record }} />}
      <button
        onClick={() => {
          if (!open) setVisit(visit + 1);
          setOpen(!open);
        }}
      >
        {open ? "Leave" : "Return"}
      </button>
      <button onClick={() => setPeer(false)}>Close peer</button>
      <button onClick={runAfterTasks} disabled={isRunning}>
        Save
      </button>
      <output data-testid="pending">{String(hasPendingTasks)}</output>
      {gates.map(({ id, finish }) => (
        <button key={id} onClick={finish}>
          Finish {id}
        </button>
      ))}
      <ol>
        {events.map((event, index) => (
          <li key={index}>{event}</li>
        ))}
      </ol>
    </>
  );
}

const withProvider = new URLSearchParams(location.search).has("provider");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {withProvider ? (
      <AfterTasksProvider>
        <Fixture />
      </AfterTasksProvider>
    ) : (
      <Fixture />
    )}
  </StrictMode>,
);
