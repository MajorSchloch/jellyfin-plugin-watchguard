using System.Security.Cryptography;
using System.Text.Json;
using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.WatchGuard.ActivityIndex;

internal static class IndexAuthorization
{
    // Equality is only an invalidation test, never permission equivalence or an
    // alternative to native item/episode authorization. Include the full native
    // policy/configuration so access changes affecting linked versions invalidate
    // counts even if the visible primary episode-ID set happens to stay equal.
    public static string Fingerprint(IUserManager users, User account)
    {
        var dto = users.GetUserDto(account) ?? throw new InvalidDataException("Native account policy unavailable.");
        if (dto.Policy is null || dto.Configuration is null) throw new InvalidDataException("Native account policy unavailable.");
        return Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
        {
            dto.Policy, dto.Configuration, account.MaxParentalRatingScore, account.MaxParentalRatingSubScore
        })));
    }
}
