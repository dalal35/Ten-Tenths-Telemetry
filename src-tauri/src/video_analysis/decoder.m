#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreImage/CoreImage.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {
    double duration, fps, start;
    uint32_t width, height;
    int32_t timescale;
} ApexMetadata;
typedef struct {
    double seconds;
    int64_t value;
    int32_t timescale;
} ApexTimestamp;

@interface ApexDecoder : NSObject
@property(nonatomic, strong) AVAssetReader *reader;
@property(nonatomic, strong) AVAssetReaderTrackOutput *output;
@property(nonatomic, strong) CIContext *context;
@property(nonatomic) CGAffineTransform transform;
@end
@implementation ApexDecoder
@end

static int fail(char *error, const char *message) {
    snprintf(error, 1024, "%s", message ?: "Video decode failed");
    return -1;
}

void *apex_video_open(const char *path, double start, ApexMetadata *meta, char *error) {
    @autoreleasepool {
        @try {
            NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
            AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:@{
                AVURLAssetPreferPreciseDurationAndTimingKey: @YES
            }];
            AVAssetTrack *track = [asset tracksWithMediaType:AVMediaTypeVideo].firstObject;
            if (!track) {
                fail(error, "File has no readable video track");
                return NULL;
            }
            double duration = CMTimeGetSeconds(asset.duration);
            CGRect bounds = CGRectApplyAffineTransform(
                (CGRect){CGPointZero, track.naturalSize}, track.preferredTransform);
            double width = fabs(bounds.size.width), height = fabs(bounds.size.height);
            if (!isfinite(duration) || duration <= 0 || !isfinite(width) ||
                !isfinite(height) || width < 1 || height < 1 || width > 65536 || height > 65536) {
                fail(error, "Invalid video duration or dimensions");
                return NULL;
            }
            NSError *failure = nil;
            AVAssetReader *reader = [[AVAssetReader alloc] initWithAsset:asset error:&failure];
            AVAssetReaderTrackOutput *output = [[AVAssetReaderTrackOutput alloc]
                initWithTrack:track outputSettings:@{
                    (id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA)
                }];
            output.alwaysCopiesSampleData = NO;
            if (!reader || ![reader canAddOutput:output]) {
                fail(error, failure.localizedDescription.UTF8String ?: "Cannot create video reader");
                return NULL;
            }
            [reader addOutput:output];
            // Read earlier than the target, rounded down, so frame selection remains strict.
            double seek = floor(fmax(0, fmin(start, duration) - 1) * 600) / 600;
            reader.timeRange = CMTimeRangeMake(CMTimeMakeWithSeconds(seek, 600), kCMTimePositiveInfinity);
            if (![reader startReading]) {
                fail(error, reader.error.localizedDescription.UTF8String);
                return NULL;
            }
            ApexDecoder *decoder = [ApexDecoder new];
            decoder.reader = reader;
            decoder.output = output;
            // Track transforms use top-left video coordinates; Core Image uses lower-left.
            CGAffineTransform t = track.preferredTransform;
            double sourceHeight = track.naturalSize.height;
            decoder.transform = CGAffineTransformMake(t.a, -t.b, -t.c, t.d,
                t.tx + t.c * sourceHeight, height - t.ty - t.d * sourceHeight);
            decoder.context = [CIContext contextWithOptions:@{kCIContextCacheIntermediates: @NO}];
            *meta = (ApexMetadata){duration, track.nominalFrameRate,
                CMTimeGetSeconds(track.timeRange.start), (uint32_t)llround(width),
                (uint32_t)llround(height), track.naturalTimeScale};
            return (__bridge_retained void *)decoder;
        } @catch (NSException *exception) {
            fail(error, exception.reason.UTF8String);
            return NULL;
        }
    }
}

// One sample per call: Rust polls cancellation between every decoded frame.
// Returns 2 for skipped sample, 1 for rendered frame, 0 for EOF, -1 for error.
int apex_video_next(void *handle, double minimum, uint32_t width, uint32_t height,
                    unsigned char *rgba, size_t length, ApexTimestamp *timestamp, char *error) {
    @autoreleasepool {
        CMSampleBufferRef sample = NULL;
        CGColorSpaceRef color = NULL;
        @try {
            ApexDecoder *decoder = (__bridge ApexDecoder *)handle;
            sample = [decoder.output copyNextSampleBuffer];
            if (!sample) {
                if (decoder.reader.status == AVAssetReaderStatusCompleted) return 0;
                return fail(error, decoder.reader.error.localizedDescription.UTF8String
                    ?: "Video reader stopped before completion");
            }
            CMTime pts = CMSampleBufferGetPresentationTimeStamp(sample);
            double seconds = CMTimeGetSeconds(pts);
            if (!CMTIME_IS_NUMERIC(pts) || !isfinite(seconds)) {
                return fail(error, "Invalid frame presentation timestamp");
            }
            *timestamp = (ApexTimestamp){seconds, pts.value, pts.timescale};
            if (seconds < minimum) return 2;
            CVPixelBufferRef pixel = CMSampleBufferGetImageBuffer(sample);
            if (!pixel || !width || !height || length < (size_t)width * height * 4) {
                return fail(error, "Invalid decoded image or output buffer");
            }
            // Core Image understands the source CVPixelBuffer's padded row stride.
            CIImage *image = [[CIImage imageWithCVPixelBuffer:pixel]
                imageByApplyingTransform:decoder.transform];
            CGRect extent = image.extent;
            if (CGRectIsEmpty(extent) || CGRectIsInfinite(extent)) {
                return fail(error, "Invalid decoded image extent");
            }
            image = [image imageByApplyingTransform:
                CGAffineTransformMakeTranslation(-extent.origin.x, -extent.origin.y)];
            image = [image imageByApplyingTransform:
                CGAffineTransformMakeScale(width / extent.size.width, height / extent.size.height)];
            color = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
            [decoder.context render:image toBitmap:rgba rowBytes:(size_t)width * 4
                bounds:CGRectMake(0, 0, width, height) format:kCIFormatRGBA8 colorSpace:color];
            return 1;
        } @catch (NSException *exception) {
            return fail(error, exception.reason.UTF8String);
        } @finally {
            if (color) CGColorSpaceRelease(color);
            if (sample) CFRelease(sample);
        }
    }
}

void apex_video_close(void *handle) {
    @autoreleasepool {
        ApexDecoder *decoder = (__bridge_transfer ApexDecoder *)handle;
        [decoder.reader cancelReading];
    }
}
