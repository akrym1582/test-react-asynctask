import { createContext, useContext, useState, type ReactNode } from "react";
import { createTaskStore, type TaskStore } from "./taskStore";

const Context = createContext<TaskStore | null>(null);

export function AsyncTasksProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createTaskStore);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useAsyncTasks() {
  const store = useContext(Context);
  if (!store) throw new Error("AsyncTasksProviderが必要です");
  return store;
}
