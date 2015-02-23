# CMakeLists.txt 20111227 (C) markc@renta.net (AGPLv3)
#
# mkdir build && cd build
# cmake .. && make
# sudo make install

project(silkjs)
cmake_minimum_required(VERSION 2.8)
include_directories(${CMAKE_SOURCE_DIR}/src)
add_definitions(-DBOOTSTRAP_SILKJS)
set(SRCS
  src/async.cpp
  src/base64.cpp
  src/buffer.cpp
  src/console.cpp
  src/fs.cpp
  src/gd.cpp
  src/global.cpp
  src/http.cpp
  src/logfile.cpp
  src/main.cpp
  src/md5.cpp
  src/mysql.cpp
  src/ncurses.cpp
  src/net.cpp
  src/popen.cpp
  src/process.cpp
  src/sem.cpp
  src/sqlite3.cpp
  src/time.cpp
  src/v8.cpp
  src/watchdog.cpp
)
set(HDRS src/SilkJS.h)
add_executable(silkjs ${SRCS} ${HDRS})
target_link_libraries(silkjs v8 mysqlclient mm gd ncurses ssl pthread sqlite3 dl)
install(TARGETS silkjs DESTINATION /usr/bin)
