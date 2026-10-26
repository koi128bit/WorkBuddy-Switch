import test from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {fixture} from "./helpers/api-fixture.mjs";

test("official OpenAI Chat SDK consumes streamed text and final actual usage", async t => {
  const f=await fixture(t), sdk=new OpenAI({apiKey:f.gateway.getKey(),baseURL:f.status.baseUrl,maxRetries:0});
  const stream=await sdk.chat.completions.create({model:"fast-model",messages:[{role:"user",content:"hi"}],stream:true,stream_options:{include_usage:true}});
  let text="",usage;
  for await(const frame of stream){text+=frame.choices[0]?.delta.content ?? "";usage=frame.usage ?? usage;}
  assert.equal(text,"private-reply");assert.equal(usage.prompt_tokens,7);assert.equal(usage.completion_tokens,3);
});
test("official Responses SDK receives empty initial message content and one complete output part", async t => {
  const f=await fixture(t), sdk=new OpenAI({apiKey:f.gateway.getKey(),baseURL:f.status.baseUrl,maxRetries:0});
  const stream=sdk.responses.stream({model:"fast-model",input:"hi",store:false});
  let initial;
  for await(const event of stream)if(event.type==="response.output_item.added")initial=event.item;
  const result=await stream.finalResponse();
  assert.deepEqual(initial.content,[]);
  assert.equal(result.output[0].content.length,1);
  assert.equal(result.output_text,"private-reply");
});
test("official Anthropic SDK consumes Messages streams and reconstructs tool JSON", async t => {
  const f=await fixture(t,async()=>new Response([
    {choices:[{delta:{tool_calls:[{index:0,id:"call_sdk",type:"function",function:{name:"lookup",arguments:'{"x":'}}]}}]},
    {choices:[{delta:{tool_calls:[{index:0,function:{arguments:"1}"}}]},finish_reason:"tool_calls"}],usage:{prompt_tokens:7,completion_tokens:3,total_tokens:10}},
  ].map(v=>"data: "+JSON.stringify(v)+"\n\n").join("")+"data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}}));
  const sdk=new Anthropic({apiKey:f.gateway.getKey(),baseURL:f.status.baseUrl.replace(/\/v1$/,""),maxRetries:0});
  const result=await sdk.messages.stream({model:"fast-model",max_tokens:64,messages:[{role:"user",content:"lookup"}],tools:[{name:"lookup",input_schema:{type:"object",properties:{x:{type:"integer"}}}}]}).finalMessage();
  assert.equal(result.stop_reason,"tool_use");
  assert.deepEqual(result.content[0],{type:"tool_use",id:"call_sdk",name:"lookup",input:{x:1}});
  assert.equal(result.usage.input_tokens,7);assert.equal(result.usage.output_tokens,3);
});
