// Шифрует глоссарий паролем и вкладывает в страницу.
// node build.js <пароль> <data.json> <куда положить index.html>
const fs = require("fs"), crypto = require("crypto");
const [pw, dataFile = "data.json", out = "index.html"] = process.argv.slice(2);
if (!pw || pw.length < 10) { console.error("Пароль должен быть не короче 10 символов"); process.exit(1); }
const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
if (data.error || !Array.isArray(data.terms)) { console.error("В данных нет терминов: " + (data.error || "неизвестный ответ")); process.exit(1); }
const iter = 600000;
const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(pw, salt, iter, 32, "sha256");
const c = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([c.update(JSON.stringify(data)), c.final(), c.getAuthTag()]);
const payload = {iter, salt: salt.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64")};
const html = fs.readFileSync(__dirname + "/template.html", "utf8").replace("/*PAYLOAD*/null", JSON.stringify(payload));
fs.writeFileSync(out, html);
console.log("Терминов: " + data.terms.length + ", страница: " + Math.round(html.length / 1024) + " КБ");
