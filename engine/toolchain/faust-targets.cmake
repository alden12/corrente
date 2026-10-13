# Faust's build targets: only the faust executable. No libraries, and no OSC or HTTP control, which
# need extra system packages.
set ( INCLUDE_EXECUTABLE  ON  CACHE STRING "" FORCE )
set ( INCLUDE_STATIC      OFF CACHE STRING "" FORCE )
set ( INCLUDE_DYNAMIC     OFF CACHE STRING "" FORCE )
set ( INCLUDE_OSC         OFF CACHE STRING "" FORCE )
set ( INCLUDE_HTTP        OFF CACHE STRING "" FORCE )
set ( OSCDYNAMIC          OFF CACHE STRING "" FORCE )
set ( HTTPDYNAMIC         OFF CACHE STRING "" FORCE )
set ( INCLUDE_ITP         OFF CACHE STRING "" FORCE )
set ( ITPDYNAMIC          OFF CACHE STRING "" FORCE )
