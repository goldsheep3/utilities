"""
这是一个视频处理脚本，用于将视频转化为计时器视频，用于精简大小和对照时间轴。
精确到0.1秒。
"""

import os
import subprocess
import tempfile
import cv2
import numpy as np

def generate_timer_video(duration, fps=30, output_file=None):
    # 解析duration参数，计算总帧数
    if isinstance(duration, str):
        parts = duration.split(':')
        if len(parts) != 3:
            raise ValueError("Invalid time format. Expected H:MM:SS.s")
        
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds_part = parts[2].split('.')
        
        if len(seconds_part) == 1:
            seconds = int(seconds_part[0])
            tenths = 0
        elif len(seconds_part) == 2:
            seconds = int(seconds_part[0])
            tenths_str = seconds_part[1].ljust(1, '0')  # 处理不足一位的情况
            tenths = int(tenths_str[0])
        else:
            raise ValueError("Invalid seconds format in time string.")
        
        total_seconds = hours * 3600 + minutes * 60 + seconds + tenths / 10
        total_frames = int(round(total_seconds * fps))
    else:
        total_frames = int(duration)
    
    # 处理输出文件路径
    if output_file is None:
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as f:
            output_file = f.name
    
    print("[BVB] 开始生成计时器视频...")
    # 创建视频写入器
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    video_writer = cv2.VideoWriter(output_file, fourcc, fps, (320, 240), isColor=True)
    if not video_writer.isOpened():
        raise IOError("Could not open video writer.")
    
    print(f"[BVB] 总帧数: {total_frames}, FPS: {fps}")
    
    # 生成每一帧
    for frame_num in range(total_frames):
        if frame_num % (fps * 10) == 0:  # 每10秒打印一次进度
            print(f"[BVB] 生成帧 {frame_num}/{total_frames}...")
        current_time = frame_num / fps
        rounded_time = round(current_time * 10) / 10  # 四舍五入到0.1秒
        
        # 转换时间到H:MM:SS.s格式
        total_tenths = int(round(rounded_time * 10))
        hours = total_tenths // (3600 * 10)
        remaining_tenths = total_tenths % (3600 * 10)
        minutes = remaining_tenths // (60 * 10)
        remaining_tenths %= (60 * 10)
        seconds = remaining_tenths // 10
        tenths = remaining_tenths % 10
        
        time_str = f"{hours}:{minutes:02d}:{seconds:02d}.{tenths}"
        
        # 创建黑底图像
        img = np.zeros((240, 320, 3), dtype=np.uint8)
        
        # 设置字体和文字位置
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 1
        thickness = 2
        text_size, _ = cv2.getTextSize(time_str, font, font_scale, thickness)
        text_width, text_height = text_size
        x = (320 - text_width) // 2
        y = (240 + text_height) // 2  # 垂直居中
        
        # 绘制文字
        cv2.putText(img, time_str, (x, y), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
        
        # 写入帧
        video_writer.write(img)
    
    video_writer.release()
    print("[BVB] 计时器视频生成完成:", output_file)
    return output_file

def get_total_frames(input_video_path):
    print(f"[BVB] 获取视频总帧数: {input_video_path}")
    """通过ffprobe获取视频实际总帧数"""
    try:
        cmd = [
            'ffprobe', '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=nb_frames',
            '-of', 'default=nokey=1:noprint_wrappers=1',
            input_video_path
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode == 0:
            total_frames = int(result.stdout.strip())
            print(f"[BVB] 视频总帧数: {total_frames}")
            return total_frames
    except:
        pass
    
    # 回退方案：使用ffprobe获取视频时长和帧率计算近似帧数
    cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=duration,r_frame_rate',
        '-of', 'csv=p=0',
        input_video_path
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode == 0:
        duration, frame_rate = result.stdout.strip().split(',')
        duration = float(duration)
        num, denom = map(int, frame_rate.split('/'))
        fps = num / denom
        total_frames = int(round(duration * fps))
        print(f"[BVB] 视频总帧数: {total_frames}")
        return total_frames
    raise RuntimeError("无法获取视频帧数")

def has_audio(input_video_path):
    print(f"[BVB] 检测视频是否包含音频: {input_video_path}")
    """检测视频是否包含音频流"""
    cmd = ['ffprobe', '-i', input_video_path,
           '-show_streams', '-select_streams', 'a',
           '-loglevel', 'error']
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    has_audio_stream = len(result.stdout) > 0
    print(f"[BVB] 是否包含音频: {'是' if has_audio_stream else '否'}")
    return has_audio_stream

def process_video_with_clock(input_video_path):
    print(f"[BVB] 开始处理视频: {input_video_path}")
    """
    处理视频并添加计时器的核心函数
    返回带时钟和原音频的新文件路径
    """
    # 获取视频元数据
    total_frames = get_total_frames(input_video_path)
    cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=r_frame_rate',
        '-of', 'csv=p=0',
        input_video_path
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError("无法获取视频帧率")
    num, denom = map(int, result.stdout.strip().split('/'))
    fps = num / denom
    print(f"[BVB] 视频帧率: {fps} FPS")

    # 生成计时器视频（临时文件）
    print("[BVB] 生成计时器视频...")
    timer_path = generate_timer_video(duration=total_frames, fps=fps)
    
    # 准备输出路径
    base, ext = os.path.splitext(input_video_path)
    output_path = f"{base}_clock{ext if ext else '.mp4'}"
    print(f"[BVB] 输出文件路径: {output_path}")
    
    try:
        # 处理音频合并
        if has_audio(input_video_path):
            print("[BVB] 提取音频流...")
            # 提取所有音频流到临时文件
            with tempfile.NamedTemporaryFile(suffix='.mka', delete=False) as audio_temp:
                audio_path = audio_temp.name
            
            subprocess.run([
                'ffmpeg', '-y',
                '-i', input_video_path,
                '-map', '0:a',
                '-c', 'copy',
                audio_path
            ], check=True)
            
            print("[BVB] 合并视频和音频...")
            # 合并视频和音频
            subprocess.run([
                'ffmpeg', '-y',
                '-i', timer_path,
                '-i', audio_path,
                '-map', '0:v',
                '-map', '1:a',
                '-c', 'copy',
                output_path
            ], check=True)
            
            os.remove(audio_path)
        else:
            print("[BVB] 视频无音频，直接复制视频流...")
            # 直接复制视频流
            subprocess.run([
                'ffmpeg', '-y',
                '-i', timer_path,
                '-c', 'copy',
                output_path
            ], check=True)
    
    finally:
        # 清理临时文件
        if os.path.exists(timer_path):
            os.remove(timer_path)
            print("[BVB] 清理临时计时器视频文件...")
    
    print("[BVB] 视频处理完成:", output_path)
    return output_path

# 示例用法
if __name__ == "__main__":
    print("[BVB] 程序开始运行...")
    outputs = [
        process_video_with_clock(path) for path in [
        ]
    ]
    print(f"[BVB] 处理后的视频已保存至：{outputs}")
