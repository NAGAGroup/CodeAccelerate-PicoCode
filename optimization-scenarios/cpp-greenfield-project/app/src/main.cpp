#include <format>
#include <print>

int main() {
  // show example of using std::format and std::print
  std::string name = "World";
  std::string message = std::format("Hello, {}!", name);
  std::print("{}\n", message);
  return 0;
}
