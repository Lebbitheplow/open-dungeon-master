// Every genre catalog's rules text, registered at once (src/lib/classes/
// feature-text.ts). For the server, where the DM prompt glosses a custom
// feature for the model and a module's size costs nothing. Never import this
// from a client component: it would put all six genres' text back into the
// first load issue 411 took it out of.
import cyberpunk from "@/lib/classes/cyberpunk-features.json";
import darkFantasy from "@/lib/classes/dark-fantasy-features.json";
import horror from "@/lib/classes/horror-features.json";
import mystery from "@/lib/classes/mystery-features.json";
import postApocalyptic from "@/lib/classes/post-apocalyptic-features.json";
import steampunk from "@/lib/classes/steampunk-features.json";
import { registerFeatureText, type FeaturesFile } from "@/lib/classes/feature-text";

for (const file of [cyberpunk, darkFantasy, horror, mystery, postApocalyptic, steampunk] as unknown as FeaturesFile[]) {
  registerFeatureText(file);
}
