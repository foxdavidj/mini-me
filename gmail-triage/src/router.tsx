import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { nonceContext } from "./nonce.server";
import { routeTree } from "./routeTree.gen";
const getNonce=createIsomorphicFn().server(()=>nonceContext.getStore()).client(()=>document.querySelector('meta[property="csp-nonce"]')?.getAttribute('content')??undefined);
export function getRouter() { const nonce=getNonce();return createRouter({ routeTree, scrollRestoration: true, ssr: nonce?{nonce}:{} }); }
declare module "@tanstack/react-router" { interface Register { router: ReturnType<typeof getRouter> } }
