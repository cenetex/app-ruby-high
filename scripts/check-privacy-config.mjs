import { privacyConfigurationErrors } from "../dist/index.js";
const errors = privacyConfigurationErrors();
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log("Privacy contact and retention settings are ready.");
}
