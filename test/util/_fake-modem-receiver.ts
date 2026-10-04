/** Scripted XModem / YMODEM receiver: hands out ``replies`` one byte per read, null once exhausted. */
export function fakeReceiver(replies: number[]) {
  const writes: Uint8Array[] = [];
  const queue = [...replies];
  return {
    writes,
    io: {
      write: async (data: Uint8Array) => {
        writes.push(data);
      },
      readByte: async () => queue.shift() ?? null,
    },
  };
}
