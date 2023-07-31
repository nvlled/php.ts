import { $ } from "../php.ts";

$.response.statusText = "go there";
$.response.status = 302;
$.response.headers.Location = "index.tsx?name=welcome%20back";
