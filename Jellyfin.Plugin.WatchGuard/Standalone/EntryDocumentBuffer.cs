namespace Jellyfin.Plugin.WatchGuard.Standalone;

// At most Limit bytes retained. Overflow or an explicit flush irrevocably selects passthrough.
// Never owns the host stream. No disk spill, unbounded copy, or hidden successful response.
internal sealed class EntryDocumentBuffer(Stream destination) : Stream
{
    internal const int Limit = 1024 * 1024;
    private readonly MemoryStream buffer = new();
    public bool Passthrough { get; private set; }
    public byte[] Captured => buffer.ToArray();
    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => true;
    public override long Length => buffer.Length;
    public override long Position { get => buffer.Position; set => throw new NotSupportedException(); }
    private async ValueTask PassThrough(CancellationToken cancellation)
    {
        if (Passthrough) return;
        Passthrough = true;
        buffer.Position = 0;
        await buffer.CopyToAsync(destination, cancellation);
        await buffer.DisposeAsync();
    }
    public override async ValueTask WriteAsync(ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken = default)
    {
        if (!Passthrough && bytes.Length > Limit - buffer.Length) await PassThrough(cancellationToken);
        if (Passthrough) await destination.WriteAsync(bytes, cancellationToken);
        else await buffer.WriteAsync(bytes, cancellationToken);
    }
    public override Task WriteAsync(byte[] bytes, int offset, int count, CancellationToken cancellationToken) =>
        WriteAsync(bytes.AsMemory(offset, count), cancellationToken).AsTask();
    public override void Write(byte[] bytes, int offset, int count)
    {
        if (!Passthrough && count > Limit - buffer.Length)
        {
            Passthrough = true; buffer.Position = 0; buffer.CopyTo(destination); buffer.Dispose();
        }
        if (Passthrough) destination.Write(bytes, offset, count); else buffer.Write(bytes, offset, count);
    }
    public override async Task FlushAsync(CancellationToken cancellationToken)
    {
        await PassThrough(cancellationToken); await destination.FlushAsync(cancellationToken);
    }
    public override void Flush()
    {
        if (!Passthrough) { Passthrough = true; buffer.Position = 0; buffer.CopyTo(destination); buffer.Dispose(); }
        destination.Flush();
    }
    protected override void Dispose(bool disposing) { if (disposing) buffer.Dispose(); base.Dispose(disposing); }
    public override int Read(byte[] bytes, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
}
