import test from "node:test";
import assert from "node:assert/strict";
import { createFilesApplicationActionProvider } from "../actions/providers/files-native.mjs";

function fileSpace(list) {
  const no = async () => { throw new Error("not used"); };
  return {
    schema: "ordax.file-space/11", list,
    createDirectory:no, readTextFile:no, renameEntry:no, copyFile:no, moveEntry:no,
    trashEntry:no, listTrash:no, restoreTrashEntry:no, exportFile:no, importFile:no,
  };
}

test("browse uses only the injected logical File Space", async () => {
  const provider=createFilesApplicationActionProvider(fileSpace(async path=>({
    path, entries:[{name:"relatorio.txt",kind:"file",size:12,modifiedAt:1}],
  })));
  const result=await provider.invoke({
    schema:"ordax.application-action-provider-invocation/1",
    workItemId:"files-test-work-1",
    resourceRef:"application-action:files-documents",
    appId:"files",actionId:"files.browse",arguments:{location:"Documentos"},
  });
  assert.equal(result.status,"succeeded");
  assert.equal(result.output.location,"/Documentos");
  assert.deepEqual(result.output.entries,[{name:"relatorio.txt",kind:"file",size:12}]);
});

test("browse rejects mismatched response identity", async () => {
  const provider=createFilesApplicationActionProvider(fileSpace(async ()=>({path:"/Downloads",entries:[]})));
  const result=await provider.invoke({
    schema:"ordax.application-action-provider-invocation/1",
    workItemId:"files-test-work-2",
    resourceRef:"application-action:files-documents-mismatch",
    appId:"files",actionId:"files.browse",arguments:{location:"/Documentos"},
  });
  assert.equal(result.status,"failed");
});
