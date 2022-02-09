<?php 
if ( ! function_exists( 'restly_setup' ) ) :
	/**
	 * Sets up theme defaults and registers support for various WordPress features.
	 *
	 * Note that this function is hooked into the after_setup_theme hook, which
	 * runs before the init hook. The init hook is too late for some features, such
	 * as indicating support for post thumbnails.
	 */
	function restly_setup() {
		/*
		 * Make theme available for translation.
		 * Translations can be filed in the /languages/ directory.
		 * If you're building a theme based on Restly, use a find and replace
		 * to change 'restly' to the name of your theme in all the template files.
		 */
		load_theme_textdomain( 'restly', get_template_directory() . '/languages' );

		// Add default posts and comments RSS feed links to head.
		add_theme_support( 'automatic-feed-links' );

		/*
		 * Let WordPress manage the document title.
		 * By adding theme support, we declare that this theme does not use a
		 * hard-coded <title> tag in the document head, and expect WordPress to
		 * provide it for us.
		 */
		add_theme_support( 'title-tag' );

		/*
		 * Enable support for Post Thumbnails on posts and pages.
		 *
		 * @link https://developer.wordpress.org/themes/functionality/featured-images-post-thumbnails/
		 */
		add_theme_support( 'post-thumbnails' );
		add_image_size( 'restly-blog-full', 850, 450, true);
		add_image_size( 'restly-blog-medium', 400, 300, true);
		add_image_size( 'restly-portfolio-medium', 570, 450, true);
		// This theme uses wp_nav_menu() in one location.
		register_nav_menus(
			array(
				'mainmenu' => esc_html__( 'Main Menu', 'restly' ),
			)
		);

		/*
		 * Switch default core markup for search form, comment form, and comments
		 * to output valid HTML5.
		 */
		add_theme_support(
			'html5',
			array(
				'search-form',
				'comment-form',
				'comment-list',
				'gallery',
				'caption',
				'style',
				'script',
			)
		);
		add_theme_support( 'post-formats', array(
			'gallery',
			'quote',
			'video',
			'image',
			'link',
			'audio',
		) );
		// Set up the WordPress core custom background feature.
		
		add_theme_support( 'custom-background' );
		add_theme_support( 'custom-background', apply_filters( 'restly_custom_background_args', array(
			'default-color' => 'ffffff',
			'default-image' => '',
		) ) );
		// Add theme support for selective refresh for widgets.
		add_theme_support( 'customize-selective-refresh-widgets' );
		function restly_add_editor_styles_sub_dir() {
			add_editor_style( trailingslashit( get_template_directory_uri() ) . 'assets/css/editor-style.css' );
		}
		add_action( 'after_setup_theme', 'restly_add_editor_styles_sub_dir' );
		/**
		 * Add support for core custom logo.
		 *
		 * @link https://codex.wordpress.org/Theme_Logo
		 */
		add_theme_support(
			'custom-logo',
			array(
				'height'      => 250,
				'width'       => 250,
				'flex-width'  => true,
				'flex-height' => true,
			)
		);
	}
endif;
add_action( 'after_setup_theme', 'restly_setup' );

/**
 * Set the content width in pixels, based on the theme's design and stylesheet.
 *
 * Priority 0 to make it available to lower priority callbacks.
 *
 * @global int $content_width
 */
function restly_content_width() {
	$GLOBALS['content_width'] = apply_filters( 'restly_content_width', 640 );
}
add_action( 'after_setup_theme', 'restly_content_width', 0 );

// restly pagination
if ( !function_exists('restly_pagination') ) {
    function restly_pagination(){
        the_posts_pagination(array(
            'screen_reader_text' => '',
            'prev_text'          => '<i class="fa fa-angle-left"></i>',
            'next_text'          => '<i class="fa fa-angle-right"></i>',
            'type'               => 'list',
            'mid_size'           => 1,
        ));
    }
}

// Add Span In category number
add_filter('wp_list_categories', 'restly_cat_count_span');
function restly_cat_count_span($links) {
  $links = str_replace('</a> (', '</a> <span class="number">(', $links);
  $links = str_replace(')', ')</span>', $links);
  return $links;
}
// Add Span In archive number
function restly_the_archive_count($links) {
    $links = str_replace('</a>'.esc_attr__('&nbsp;','restly').'(', '</a> <span class="number">(', $links);
    $links = str_replace(')', ')</span>', $links);
    return $links;
}
add_filter('get_archives_link', 'restly_the_archive_count');
?>