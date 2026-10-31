using System.Reflection;
// Inspect the exact packaged assembly, without executing plugin types or resolving host APIs.
var assembly = Assembly.LoadFile(Path.GetFullPath(args[0]));
Directory.CreateDirectory(args[1]);
foreach (var name in assembly.GetManifestResourceNames())
{
    if (!name.EndsWith(".js", StringComparison.Ordinal) && !name.EndsWith(".html", StringComparison.Ordinal)) continue;
    using var source = assembly.GetManifestResourceStream(name)!;
    using var target = File.Create(Path.Combine(args[1], name));
    source.CopyTo(target);
    Console.WriteLine(name);
}
