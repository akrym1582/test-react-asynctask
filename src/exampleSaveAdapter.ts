import type { ActionContext } from "./AsyncTasks";

/** 任意のHTTP通信例。エラー表示や再送判断はAPI呼び出し側で行います。 */
export function createHttpSaveAdapter<T>(url: string) {
  return {
    async save(value: T, { signal, requestId }: ActionContext): Promise<void> {
      const response = await fetch(url, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestId,
        },
        body: JSON.stringify(value),
      });
      if (!response.ok)
        throw new Error(`保存APIがエラーを返しました: ${response.status}`);
    },
  };
}

/** テスト/デモ用。同じIDのデータ重複をAPI側で処理する契約の例です。実サーバーではありません。 */
export function createMemorySaveAdapter<T>() {
  const records = new Map<string, string>();
  return {
    async save(value: T, { requestId }: ActionContext) {
      const body = JSON.stringify(value);
      if (records.has(requestId) && records.get(requestId) !== body)
        throw new Error("冪等性キーのpayloadが一致しません");
      records.set(requestId, body);
    },
    getCount: () => records.size,
  };
}
