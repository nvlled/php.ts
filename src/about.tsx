import { $ } from "$base/php.ts";
import { Layout } from "./common.tsx";

$.response.status = 203;
$.response.statusText = "Okay";
$.response.headers["Content-Type"] = "text/html";

$(
  <Layout>
    <h1>About</h1>
    Nothing to see here.
    <br />
    <a href="redirect.tsx">Redirect to home.</a>
  </Layout>
);
