using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;

namespace Jellyfin.Plugin.WatchGuard.Standalone;

// Native StaticFileMiddleware uses SendFileAsync. Capture only that file transfer without
// StreamResponseBodyFeature's implicit pre-transfer flush. Explicit Start/Flush still bypasses.
internal sealed class EntryDocumentBodyFeature(EntryDocumentBuffer buffer, IHttpResponseBodyFeature prior)
    : StreamResponseBodyFeature(buffer, prior)
{
    public override async Task SendFileAsync(string path, long offset, long? count, CancellationToken cancellationToken)
    {
        await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite,
            16384, FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (offset < 0 || offset > file.Length || count < 0 || count > file.Length - offset)
            throw new ArgumentOutOfRangeException(nameof(offset));
        file.Position = offset;
        var remaining = count ?? file.Length - offset;
        var chunk = new byte[16384];
        while (remaining > 0)
        {
            var read = await file.ReadAsync(chunk.AsMemory(0, (int)Math.Min(chunk.Length, remaining)), cancellationToken);
            if (read == 0) throw new EndOfStreamException("Web entry document changed during transfer.");
            await Stream.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
            remaining -= read;
        }
    }
    public override async Task StartAsync(CancellationToken cancellationToken = default)
    {
        await Stream.FlushAsync(cancellationToken);
        await PriorFeature!.StartAsync(cancellationToken);
    }
    public override void DisableBuffering() { Stream.Flush(); PriorFeature!.DisableBuffering(); }
}
