import { getProviderStatus } from "./providers.mjs";

console.log(JSON.stringify(await getProviderStatus(), null, 2));
