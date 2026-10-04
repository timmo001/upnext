// Writes the docs command reference from the CLI's own help output, so the
// page always matches the command tree in src/index.ts.
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const outDir = "docs/src/content/docs/commands";

// Imported by docs/blume.config.ts for the Commands sidebar group.
const sidebarFile = "docs/commands-sidebar.json";

interface Subcommand {
  readonly name: string;
  readonly alias: string | undefined;
}

const sections = (help: string) => {
  const result = new Map<string, Array<string>>();
  let current: Array<string> | undefined;

  for (const line of help.split("\n")) {
    if (/^[A-Z][A-Z ]+$/.test(line)) {
      current = [];
      result.set(line, current);
    } else if (current !== undefined && line.trim() !== "") {
      current.push(line);
    }
  }

  return result;
};

const subcommandsOf = (help: string): ReadonlyArray<Subcommand> =>
  (sections(help).get("SUBCOMMANDS") ?? []).flatMap((line) => {
    const [, name, alias] = /^\s+([\w-]+)(?:, ([\w-]+))?\s/.exec(line) ?? [];

    return name === undefined ? [] : [{ name, alias }];
  });

const withoutGlobalFlags = (help: string) =>
  (help.split("\nGLOBAL FLAGS\n")[0] ?? help).trimEnd();

const program = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const helpFor = (commandPath: ReadonlyArray<string>) =>
    spawner.string(
      ChildProcess.make("bun", ["src/index.ts", ...commandPath, "--help"]),
    );

  const render = (
    lines: Array<string>,
    commandPath: ReadonlyArray<string>,
    alias: string | undefined,
  ): Effect.Effect<void, PlatformError> =>
    Effect.gen(function* () {
      const help = yield* helpFor(commandPath);
      const heading = ["upnext", ...commandPath].join(" ");

      lines.push(`## \`${heading}\``, "");

      if (alias !== undefined) {
        const aliasPath = [...commandPath.slice(0, -1), alias];
        lines.push(`Alias: \`${["upnext", ...aliasPath].join(" ")}\``, "");
      }

      lines.push("```text", withoutGlobalFlags(help), "```", "");

      yield* Effect.forEach(
        subcommandsOf(help),
        (subcommand) =>
          render(lines, [...commandPath, subcommand.name], subcommand.alias),
        { discard: true },
      );
    });

  const page = (
    title: string,
    description: string,
    body: Array<string>,
    sidebarLabel?: string,
  ) =>
    [
      "---",
      `title: ${title}`,
      `description: ${description}`,
      ...(sidebarLabel === undefined
        ? []
        : ["sidebar:", `  label: ${sidebarLabel}`]),
      "---",
      "",
      "<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->",
      "",
      ...body,
    ]
      .join("\n")
      .trimEnd() + "\n";

  const rootHelp = yield* helpFor([]);
  const commands = subcommandsOf(rootHelp);
  const slug = (name: string) => name.replaceAll("_", "-");

  yield* fs.remove(outDir, { recursive: true, force: true });
  yield* fs.makeDirectory(outDir, { recursive: true });

  yield* Effect.forEach(
    commands,
    (command) =>
      Effect.gen(function* () {
        const lines: Array<string> = [
          `Every \`upnext ${command.name}\` command and its help, as \`--help\` prints it. Each also accepts the [global flags](/commands#global-flags).`,
          "",
        ];

        yield* render(lines, [command.name], command.alias);

        yield* fs.writeFileString(
          path.join(outDir, `${slug(command.name)}.md`),
          page(
            `upnext ${command.name}`,
            `Arguments and flags for every upnext ${command.name} command.`,
            lines,
            command.name,
          ),
        );
      }),
    { discard: true },
  );

  yield* fs.writeFileString(
    path.join(outDir, "index.md"),
    page(
      "Commands",
      "Every upnext command, argument and flag, generated from the CLI's help.",
      [
        "Each command has its own page with its help, as `upnext <command> --help` prints it.",
        "",
        "| Command | Alias |",
        "| --- | --- |",
        ...commands.map(
          (command) =>
            `| [\`${command.name}\`](/commands/${slug(command.name)}) | ${command.alias === undefined ? "None" : `\`${command.alias}\``} |`,
        ),
        "",
        "## Global flags",
        "",
        "```text",
        rootHelp.trimEnd(),
        "```",
      ],
    ),
  );

  yield* fs.writeFileString(
    sidebarFile,
    `${JSON.stringify(
      [
        "/commands",
        ...commands.map((command) => `/commands/${slug(command.name)}`),
      ],
      null,
      2,
    )}\n`,
  );

  yield* Effect.log(`Wrote ${commands.length + 1} pages to ${outDir}`);
});

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
