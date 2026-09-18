#!/usr/bin/env node
// Standalone key-generation runner — Node tooling (not part of the runtime
// library), run once by an operator to produce the three environment
// variables the app's VAPID config expects. Writes no file: the private key
// only ever exists on the operator's own screen and in whatever secret
// store they paste it into.
import { generateVapidKeys } from "../src/vapid.js";

async function main() {
  const { publicKey, privateKey } = await generateVapidKeys();

  console.log(`BANDPLATE_VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`BANDPLATE_VAPID_PRIVATE_KEY=${privateKey}`);
  console.log("BANDPLATE_VAPID_SUBJECT=mailto:you@example.com");
  console.warn(
    "\nWarning: rotating VAPID keys invalidates every existing push subscription — every subscriber will need to re-subscribe.",
  );
}

main();
