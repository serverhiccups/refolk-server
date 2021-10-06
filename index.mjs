import Typesense from "typesense";
import fetch from "node-fetch";
import parser from "fast-xml-parser";
import { decode as decodeEntities } from "html-entities"
import { readFileSync } from "fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const argv = yargs(hideBin(process.argv)).argv;

if(argv.masterKey == undefined) {
	console.error("No master key supplied. Use --masterKey={key}.");
	process.exit(1);
}
let masterKey = String(argv.masterKey);
console.dir(argv.masterKey)

let xmlPaths = [
    "http://folkets-lexikon.csc.kth.se/folkets/folkets_en_sv_public.xml",
    "http://folkets-lexikon.csc.kth.se/folkets/folkets_sv_en_public.xml"
	// "./folkets_sv_en_public.xml",
	// "./folkets_en_sv_public.xml"
]

let client = new Typesense.Client({
	'nodes': [{
		'host': 'localhost',
		'port': '80',
		'protocol': 'http'
	}],
	'apiKey': String(masterKey),
	"connectionTimeoutSeconds": 60
})

await Promise.all((await client.keys().retrieve()).keys.map(async (k) => {
	await client.keys(String(k.id)).delete();
}));

let searchOnlyKey = await client.keys().create({
	"description": "Search-only website key (not for use)",
	"actions": ["documents:search"],
	"collections": ["refolk"]
})

let websiteKey = await client.keys().generateScopedSearchKey(searchOnlyKey.value, {
	'query_by': 'key, translation, inflection, definition, synonyms, idioms, idiomsTranslation',
	'query_by_weights': '10, 8, 6, 6, 6, 4, 4',
	'limit_hits': 50,
	'per_page': 50
})

try {
	await client.collections("refolk").delete();
} catch (e) {}

let schema = {
	"name": "refolk",
	"fields": [
		{
			"name": "type",
			"type": "string[]",
			"facet": true
		},
		{
			"name": "lang",
			"type": "string",
			"facet": true
		},
		{
			"name": "key",
			"type": "string",
			"facet": true
		},
		{
			"name": "translation",
			"type": "string[]",
			"facet": true
		},
		{
			"name": "definition",
			"type": "string[]", // key, value
			"facet": false
		},
		{
			"name": "inflection",
			"type": "string[]",
			"facet": true
		},
		{
			"name": "idioms",
			"type": "string[]",
			"facet": true
		},
		{
			"name": "idiomsTranslation",
			"type": "string[]",
			"facet": true
		},
		{
			"name": "synonyms",
			"type": "string[]",
			"facet": true
		}
	]
}

await client.collections().create(schema);

function dd(s) {return decodeEntities(decodeEntities(s))}

/**
 * This function is not my best work...
 * @param el The element to parse
 * @returns a clean version of the element.
 */
function parseEntry(el) {
	// console.dir(el.paradigm);
	return {
		type: el.attr["@_class"] ? el.attr['@_class'].split(",") : [],
		lang: el.attr['@_lang'],
		key: String(el.attr['@_value']),
		translation: el.translation ? el.translation?.attr == undefined ? el.translation?.map((t) => {
			return t.attr["@_value"];
		}) : [el.translation?.attr["@_value"]] : [],
		translationComment: el.translation ? el.translation?.attr == undefined ? el.translation?.map((t) => {
			return dd(t.attr["@_comment"]);
		}) : [dd(el.translation?.attr["@_comment"])] : [],
		comment: el.attr['@_comment'] ? dd(el.attr['@_comment']) : undefined,
		phonetic: el?.phonetic?.attr["@_value"],
		examples: el.example?.attr == undefined ? el?.example?.map((ex) => {
			return {value: ex.attr['@_value'], translation: ex.translation?.attr["@_value"]}
		}) : [{value: el.example.attr["@_value"], translation: el.example.translate?.attr["@_value"]}],
		explanation: el.explanation ? {
			text: dd(el?.explanation?.attr["@_value"]),
			translation: dd(el?.explanation?.translation?.attr["@_value"])
		} : undefined,
		definition: el.definition?.attr != undefined ? el.definition?.translation?.attr["@_value"] != undefined ? [
			el.definition?.attr["@_value"],
			el.definition?.translation?.attr["@_value"]
		] : [el.definition?.attr["@_value"]] : [],
		idioms: el?.idiom ? !el.idiom?.attr ? el.idiom.map((id) => {
			return dd(id.attr["@_value"])
		}) : [dd(el.idiom.attr["@_value"])] : [],
		idiomsTranslation: el?.idiom ? !el.idiom?.attr ? el.idiom.map((id) => {
			return dd(id.translation?.attr["@_value"])
		}) : [dd(el.idiom?.translation?.attr["@_value"])] : [],
		inflection: el.paradigm?.inflection ? !el.paradigm.inflection?.attr ? el.paradigm.inflection.map((i) => {
			return i.attr["@_value"];
		}) : [el.paradigm.inflection.attr["@_value"]] : [],
		synonyms: el.synonym ? el.synonym?.attr == undefined ? el.synonym?.map((s) => {
			return s.attr["@_value"]
		}) : [el.synonym?.attr["@_value"]] : []
	}
}

await Promise.all(xmlPaths.map(async (url) => {
	let res = await fetch(url, {

	});
	if(res.status != 200) throw Error("could not download xml");
	let text = await res.text();
	// let text = readFileSync(url, {"encoding": "utf-8"});

	let jsonObj = parser.parse(text, {
		cdataTagName: "__cdata",
		attrNodeName: "attr",
		parseAttributeValue: false,
		ignoreAttributes: false
	});

	let parsedDict = jsonObj["dictionary"]["word"].map((ent) => {
		return parseEntry(ent);
	});

	try {
		await client.collections('refolk').documents().import(parsedDict, {action: 'create'});
	} catch (e) {
		console.dir(e);
	}
}))

console.log("Your website api key is: " + websiteKey);