// Tiny VFR MOV fixtures generated with system APIs; no downloaded media or runtime tools.
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>

static int finish(AVAssetWriter *writer, AVAssetWriterInput *input) {
    [input markAsFinished];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    [writer finishWritingWithCompletionHandler:^{ dispatch_semaphore_signal(done); }];
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    if (writer.status != AVAssetWriterStatusCompleted) {
        fprintf(stderr, "%s\n", writer.error.description.UTF8String);
        return 5;
    }
    return 0;
}

static int audioOnly(NSURL *url) {
    NSError *error = nil;
    AVAssetWriter *writer = [[AVAssetWriter alloc] initWithURL:url
        fileType:AVFileTypeQuickTimeMovie error:&error];
    AVAssetWriterInput *input = [[AVAssetWriterInput alloc]
        initWithMediaType:AVMediaTypeAudio outputSettings:nil];
    [writer addInput:input];
    if (![writer startWriting]) return 10;
    [writer startSessionAtSourceTime:kCMTimeZero];
    AudioStreamBasicDescription asbd = {8000, kAudioFormatLinearPCM,
        kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
        2, 1, 2, 1, 16, 0};
    CMAudioFormatDescriptionRef format = NULL;
    CMBlockBufferRef block = NULL;
    CMSampleBufferRef sample = NULL;
    int status = 0;
    if (CMAudioFormatDescriptionCreate(NULL, &asbd, 0, NULL, 0, NULL, NULL, &format)) {
        return 11;
    }
    if (CMBlockBufferCreateWithMemoryBlock(NULL, NULL, 1600, NULL, NULL, 0, 1600, 0, &block)) {
        status = 12;
        goto cleanup;
    }
    CMBlockBufferFillDataBytes(0, block, 0, 1600);
    CMSampleTimingInfo timing = {CMTimeMake(1, 8000), kCMTimeZero, kCMTimeInvalid};
    size_t size = 2;
    if (CMSampleBufferCreateReady(NULL, block, format, 800, 1, &timing, 1, &size, &sample)) {
        status = 13;
        goto cleanup;
    }
    while (!input.readyForMoreMediaData) [NSThread sleepForTimeInterval:0.001];
    if (![input appendSampleBuffer:sample]) status = 14;
cleanup:
    if (sample) CFRelease(sample);
    if (block) CFRelease(block);
    if (format) CFRelease(format);
    return status ? status : finish(writer, input);
}

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc < 2) return 1;
        NSURL *url = [NSURL fileURLWithPath:@(argv[1])];
        if (argc > 2 && !strcmp(argv[2], "audio")) return audioOnly(url);
        BOOL seek = argc > 2 && (!strcmp(argv[2], "seek-vfr") || !strcmp(argv[2], "seek-bframes"));
        BOOL bframes = argc > 2 && !strcmp(argv[2], "seek-bframes");
        NSError *error = nil;
        AVAssetWriter *writer = [[AVAssetWriter alloc] initWithURL:url
            fileType:AVFileTypeQuickTimeMovie error:&error];
        AVAssetWriterInput *input = [[AVAssetWriterInput alloc]
            initWithMediaType:AVMediaTypeVideo outputSettings:@{
                AVVideoCodecKey: bframes ? AVVideoCodecTypeH264 : AVVideoCodecTypeJPEG, AVVideoWidthKey: @64, AVVideoHeightKey: @32
            }];
        AVAssetWriterInputPixelBufferAdaptor *adaptor = [[AVAssetWriterInputPixelBufferAdaptor alloc]
            initWithAssetWriterInput:input sourcePixelBufferAttributes:@{
                (id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
                (id)kCVPixelBufferWidthKey: @64, (id)kCVPixelBufferHeightKey: @32
            }];
        if (argc > 2 && !strcmp(argv[2], "rotate")) {
            input.transform = CGAffineTransformMakeRotation(M_PI_2);
        }
        [writer addInput:input];
        if (![writer startWriting]) {
            fprintf(stderr, "start: %s\n", writer.error.description.UTF8String);
            return 2;
        }
        // Empty leading edit from 0 to 2 seconds deliberately tests asset timeline PTS.
        [writer startSessionAtSourceTime:kCMTimeZero];
        int ticks[] = {20, 21, 24, 29};
        BOOL cfr = argc > 2 && !strcmp(argv[2], "cfr");
        for (int i = 0; i < (seek ? 300 : (cfr ? 8 : 4)); i++) {
            while (!input.readyForMoreMediaData) [NSThread sleepForTimeInterval:0.001];
            CVPixelBufferRef pixel = NULL;
            if (CVPixelBufferPoolCreatePixelBuffer(NULL, adaptor.pixelBufferPool, &pixel)
                != kCVReturnSuccess) return 3;
            CVPixelBufferLockBaseAddress(pixel, 0);
            unsigned char *base = CVPixelBufferGetBaseAddress(pixel);
            size_t stride = CVPixelBufferGetBytesPerRow(pixel);
            for (int y = 0; y < 32; y++) {
                for (int x = 0; x < 64; x++) {
                    unsigned char *p = base + y * stride + x * 4;
                    p[0] = i == 2 ? 255 : 0;
                    p[1] = i == 1 ? 255 : 0;
                    p[2] = i == 0 ? 255 : 0;
                    p[3] = 255;
                    if (argc > 2) {
                        p[0] = y >= 16 ? 255 : 0;
                        p[1] = 0;
                        p[2] = y < 16 ? 255 : 0;
                    }
                }
            }
            CVPixelBufferUnlockBaseAddress(pixel, 0);
            BOOL ok = [adaptor appendPixelBuffer:pixel
                withPresentationTime:CMTimeMake(seek ? (20 + i + (!bframes ? i / 3 : 0)) : (cfr ? i : ticks[i]), 10)];
            CVPixelBufferRelease(pixel);
            if (!ok) return 4;
        }
        return finish(writer, input);
    }
}
