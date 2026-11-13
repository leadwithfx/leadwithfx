import w, { validate } from "./index.js";
const ok = Array(12).fill(2);
console.log("valid:", !!validate({a: ok}), "bad len:", validate({a:[1]}), "bad val:", validate({a:[...ok.slice(0,11),9]}), "str:", validate({a:["x",...ok.slice(1)]}));
globalThis.fetch = async (u, o) => { const b = JSON.parse(o.body); console.log("model:", b.model, "| prompt lines:", b.messages[0].content.split("\n").length); return new Response(JSON.stringify({content:[{text:"Test summary text for the reflection box that is long enough."}]}), {status:200}); };
const mk = (origin, body) => new Request("https://x/", {method:"POST", headers:{Origin:origin,"content-type":"application/json"}, body: JSON.stringify(body)});
let r = await w.fetch(mk("https://leadwithfx.com",{a:ok}), {ANTHROPIC_API_KEY:"k"}); console.log(r.status, await r.json());
r = await w.fetch(mk("https://evil.com",{a:ok}), {ANTHROPIC_API_KEY:"k"}); console.log("evil origin:", r.status);
r = await w.fetch(mk("https://leadwithfx.com",{a:[1]}), {ANTHROPIC_API_KEY:"k"}); console.log("bad answers:", r.status);
