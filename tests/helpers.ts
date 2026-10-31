import { act } from "@testing-library/react";
/** テストから成功・失敗のタイミングを制御するPromiseを作ります。 */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export const never = () => new Promise<never>(() => {});
export const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
