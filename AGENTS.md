

## Project map

`PROJECT_MAP.md` in the project root lists every folder with its file count and file names. Read it before exploring the tree instead of running repeated `ls`/`glob` calls. It is regenerated automatically after file changes.


## Media generation

You can create images, video, speech and music with the on-device media factory:

```bash
media-gen image "a red fox in snow, cinematic"
media-gen video "waves at sunset" model-id
media-gen tts "Привет, это озвучка"
media-gen music "lo-fi beat, 30s"
```

The command prints JSON with the absolute path of the generated file. The user confirms every generation.
Attach the returned path to your answer so it appears in the chat.
