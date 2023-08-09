# php.ts

php.ts is [deno](https://deno.land) static site generator with a development workflow
similar to [PHP](https://php.net), but with typesafe JSX
and all the tooling that comes with deno and javascript ecosystem.

```tsx
$(
  <div style={{ background: "#222", color: "#fff" }}>
    <p>hello there</p>
    <a href="other.tsx?category=test">other page</a>
  </div>
);
console.log("<div>this will also be part of the html output</div>");
console.log(`<p>query parameter value of x: ${$.request.data.x}</p>`);
```

## Development workflow

The development process is very similar to the goodbad ole days
of early PHP sites:

0. start dev server: `$ ./php.ts dev`
1. create a page (example.tsx)
2. view in browser (http://localhost:3000/example.tsx)
3. edit page
4. refresh page in browser
5. goto 3 if not yet done
6. generate html files: `$ ./php.ts build`
7. push html files to repository or server

## But why?

If you are someone who has strong allergic reactions to
anything related to JS or PHP, you might think this is
a troll or joke project. You are not too far off actually.
You ask me a "but why", I give you a "what if". I set out
on a flaming trainwreck of a journey with a question mind:
what if I could do PHP-like development but with a modern tooling
and libraries of typescript.

I scratched a technical itch, now I'm sharing my mild
skin irritation with random people AHA ha Ah HA.
More seriously, despite my initial intention,
I do believe php.ts did turn out to be quite useable
for actual projects, for me at least.

## Setup and Installation

1. `$ mkdir your-site-name; cd your-site-name`
2. `$ deno run https://deno.land/x/php_ts/php.ts init`
   Alternatively, you can just manually download php.ts,
   `chmod +x` it, then run `./php init`
3. `$ ./php.ts --help` to see help contents

Then take a quick glance on the [documentation](documentation.md).
