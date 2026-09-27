/**
 * The one signal every flash engine gets for a device that went away (#1896).
 */
import { describe, expect, it } from "vitest";

import { disconnectEvents } from "../_web-serial.js";
import { SerialDeviceLostError } from "../../src/util/serial-open-error.js";
import { watchPortLost } from "../../src/util/serial-port-lost.js";

const fakePort = (connected?: boolean) => {
  const events = disconnectEvents();
  return { events, port: { ...events, connected } as unknown as SerialPort };
};

describe("watchPortLost", () => {
  it("says nothing while the device is there", async () => {
    const { port } = fakePort(true);
    const watch = watchPortLost(port);
    const settled = await Promise.race([watch.gone.catch(() => "gone"), "there"]);
    expect(settled).toBe("there");
    expect(watch.lost).toBeNull();
  });

  it("reports the device gone when the port does, once", async () => {
    const { port, events } = fakePort(true);
    const watch = watchPortLost(port);
    events.fire();
    await expect(watch.gone).rejects.toBeInstanceOf(SerialDeviceLostError);
    const first = watch.lost;
    events.fire();
    expect(watch.lost).toBe(first);
  });

  it("reports a device that was gone before anyone watched", async () => {
    const watch = watchPortLost(fakePort(false).port);
    expect(watch.lost).toBeInstanceOf(SerialDeviceLostError);
    await expect(watch.gone).rejects.toBe(watch.lost);
  });

  it("trusts the event where the browser does not say whether it is connected", () => {
    expect(watchPortLost(fakePort().port).lost).toBeNull();
  });

  it("stops watching when disposed", () => {
    const { port, events } = fakePort(true);
    const watch = watchPortLost(port);
    expect(events.listenerCount()).toBe(1);
    watch.dispose();
    expect(events.listenerCount()).toBe(0);
  });
});
