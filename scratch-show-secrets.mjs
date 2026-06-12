/**
 * Open a VISIBLE browser window showing the secrets add-secret dialog with
 * mock devices, so the wa-select target picker can be eyeballed beside the
 * styled name input. Mounts inside the app-shell so contexts resolve.
 */
import puppeteer from "puppeteer";

const browser = await puppeteer.launch({
  headless: false,
  defaultViewport: null,
  args: ["--window-size=1100,820"],
});
const page = (await browser.pages())[0] ?? (await browser.newPage());
await page.goto("http://localhost:5176/", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));

const status = await page.evaluate(async () => {
  const shell = document.querySelector("esphome-app");
  if (!shell?.shadowRoot) return "no app-shell";
  const el = document.createElement("esphome-secrets-structured-editor");
  shell.shadowRoot.appendChild(el);
  await customElements.whenDefined("esphome-secrets-structured-editor");
  await el.updateComplete;
  el._devices = [
    { name: "living-room", friendly_name: "Living Room", configuration: "living-room.yaml" },
    { name: "garage-door", friendly_name: "Garage Door", configuration: "garage-door.yaml" },
  ];
  el._openAdd();
  await el.updateComplete;
  return "opened";
});
console.log("status:", status);
console.log("Visible window open with the Add Secret dialog. Close it when done.");

await new Promise((resolve) => browser.on("disconnected", resolve));
