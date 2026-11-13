import { headers } from "next/headers";
import { copyFor, LANG_HEADER, type Copy } from "@/shared/copy";

// The page's words for a server component (#352): the language the proxy picked and passed on in a request header, so a component
// deep in a page needs no lang prop. Client components use useCopy(); a component rendered on both sides takes a lang prop.
export const serverCopy = async (): Promise<Copy> => copyFor((await headers()).get(LANG_HEADER) ?? "");
