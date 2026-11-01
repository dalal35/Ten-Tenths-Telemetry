#include <opencv2/imgproc.hpp>
#include <opencv2/video/tracking.hpp>
#include <algorithm>
#include <cmath>
#include <vector>

struct Tracker { cv::Mat previous; };
extern "C" {
void* motion_create() noexcept { try { return new Tracker; } catch (...) { return nullptr; } }
void motion_destroy(void* p) noexcept { delete static_cast<Tracker*>(p); }
int motion_push(void* p, const unsigned char* pixels, int width, int height, int reset, double* yaw, double* quality, double* support) noexcept {
    try {
        auto& tracker = *static_cast<Tracker*>(p);
        cv::Mat frame(height, width, CV_8UC1, const_cast<unsigned char*>(pixels));
        *quality = 0;
        *support = -1;
        if (!reset && !tracker.previous.empty()) {
            *support = 0;
            std::vector<cv::Point2f> points, next, back;
            std::vector<unsigned char> forward_status, backward_status;
            std::vector<float> errors;
            cv::goodFeaturesToTrack(tracker.previous, points, 300, 0.01, 7);
            if (!points.empty()) {
                cv::calcOpticalFlowPyrLK(tracker.previous, frame, points, next, forward_status, errors);
                cv::calcOpticalFlowPyrLK(frame, tracker.previous, next, back, backward_status, errors);
                std::vector<double> shifts;
                size_t road_points = 0, tracked_road_points = 0;
                for (size_t i = 0; i < points.size(); ++i) {
                    bool road = points[i].x >= width / 8.0 && points[i].x < width * 7.0 / 8.0
                        && points[i].y >= height / 4.0 && points[i].y < height * 4.0 / 5.0
                        && !(points[i].y >= height * 0.65 && points[i].x >= width * 0.28 && points[i].x < width * 0.85);
                    if (road) ++road_points;
                    if (forward_status[i] && backward_status[i] && cv::norm(points[i] - back[i]) <= 1.0) {
                        shifts.push_back(next[i].x - points[i].x);
                        if (road) ++tracked_road_points;
                    }
                }
                // Fixed cockpit features must not certify continuity of the road scene.
                *support = road_points >= 8 ? double(tracked_road_points) / road_points : -1;
                if (shifts.size() >= 12) {
                    auto middle = shifts.begin() + shifts.size() / 2;
                    std::nth_element(shifts.begin(), middle, shifts.end());
                    if (std::abs(*middle) >= 0.1) { *yaw = *middle; *quality = double(shifts.size()) / points.size(); }
                }
            }
        }
        tracker.previous = frame.clone();
        return 0;
    } catch (...) { return -1; }
}
}

// Compact appearance signature; exclude the sky and fixed cockpit where possible.
extern "C" int scene_descriptor(const unsigned char* pixels, int width, int height, float* output, double* checker) noexcept {
    try {
        cv::Mat frame(height, width, CV_8UC1, const_cast<unsigned char*>(pixels)), small;
        int top = height / 4, bottom = height * 4 / 5;
        cv::resize(frame(cv::Rect(width / 8, top, width * 3 / 4, bottom - top)), small, cv::Size(16, 12), 0, 0, cv::INTER_AREA);
        // Alternating quadrants identify checker saddles; a single edge has equal signs.
        if (checker) {
        cv::Mat sums, checker_small;
        int cw=std::min(width,160), ch=std::max(1,height*cw/width);
        cv::resize(frame,checker_small,cv::Size(cw,ch),0,0,cv::INTER_AREA);
        cv::integral(checker_small, sums, CV_64F);
        auto patch_mean = [&](int x0, int y0, int x1, int y1) {
            return (sums.at<double>(y1,x1)-sums.at<double>(y0,x1)-sums.at<double>(y1,x0)+sums.at<double>(y0,x0))/((x1-x0)*(y1-y0));
        };
        auto visible = [&](int x, int y) { return !(y > ch*0.65 && x > cw*0.28 && x < cw*0.85); };
        *checker = 0;
        for (int rx : {4,8,12}) for (int ry : {2,3,6}) {
            auto saddle = [&](int x, int y) {
                double a=patch_mean(x-rx,y-ry,x,y), b=patch_mean(x,y-ry,x+rx,y);
                double c=patch_mean(x-rx,y,x,y+ry), d=patch_mean(x,y,x+rx,y+ry);
                if ((a-b)*(c-d)>=0 || (a-c)*(b-d)>=0) return 0.0;
                return std::min({std::abs(a-b),std::abs(c-d),std::abs(a-c),std::abs(b-d)})/255.0;
            };
            for (int y=std::max(ry,int(ch*0.35)); y<std::min(ch-ry,int(ch*0.90)); y+=3)
                for (int x=rx; x<cw-rx; x+=3) {
                    if (!visible(x,y)) continue;
                    double score=saddle(x,y), paired=0;
                    if (x+3*rx<cw && visible(x+2*rx,y)) paired=saddle(x+2*rx,y);
                    // Partial occlusion can leave a single saddle, with weaker evidence.
                    *checker=std::max(*checker,std::max(score*0.5,std::min(score,paired)));
                }
        }
        }
        cv::Mat values;
        small.convertTo(values, CV_32F);
        cv::Scalar mean, deviation;
        cv::meanStdDev(values, mean, deviation);
        for (int y = 0; y < 12; ++y)
            for (int x = 0; x < 16; ++x)
                output[y * 16 + x] = (values.at<float>(y,x) - mean[0]) / std::max(8.0, deviation[0]);
        return 0;
    } catch (...) { return -1; }
}
